import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isClientNote, MAX_TOOL_STEPS } from "../assistant/schema";
import { resolveTelegramAgent } from "../telegram/registry";
import { loadClientNames, matchClient } from "../whatsapp/apply";
import { latestPending } from "../whatsapp/drafts";
import type { Extraction } from "../whatsapp/schema";
import { hkToday } from "../weeks";
import { enqueueJob, jobId, openJob, type Job } from "./jobs";

const setting = z.object({
  owner: z.string().uuid(),
  sentAt: z.string().datetime(),
  nameHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const reported = new Set<string>();
function reportRecoveryBlock(reason: string) {
  if (reported.has(reason)) return;
  reported.add(reason);
  console.info("Original Telegram note recovery skipped:", reason);
}

const hashName = (name: string) => createHash("sha256")
  .update(name.normalize("NFKC").trim().toLowerCase()).digest("hex");

export function recoveryMatches(result: Extraction, nameHash: string) {
  return result.response?.kind === "update" && result.meeting?.occurred === true &&
    !result.clarification?.trim() && hashName(result.client.name) === nameHash &&
    [...(result.client_names ?? []), ...(result.tasks ?? []).map((task) => task.name)]
      .every((name) => hashName(name) === nameHash);
}

/** Opt-in repair for one authenticated Telegram note that reached the old research limit. */
export async function queueNoteRecovery(db: SupabaseClient) {
  const config = process.env.ZEST_NOTE_RECOVERY;
  if (!config) return;
  const { owner, sentAt, nameHash } = setting.parse(JSON.parse(config));
  const at = Date.parse(sentAt);
  const now = Date.now();
  if (now < at || now - at > 6 * 3600_000) return;

  const recoveryId = `telegram-note-recovery:${owner}:${sentAt}`;
  const { data: queued, error: queuedError } = await db.from("wa_drafts").select("id").eq("id", jobId(recoveryId)).maybeSingle();
  if (queuedError) throw Error("Could not check recovery queue");
  if (queued) return;

  const { data: rows, error } = await db.from("wa_drafts").select("id,payload").eq("owner_id", owner)
    .eq("status", "cancelled").like("payload", "codex-job-v1.done.%")
    .gte("created_at", new Date(at - 30_000).toISOString())
    .lt("created_at", new Date(at + 90_000).toISOString()).limit(30);
  if (error) throw Error("Could not read original Telegram job");

  const sources = (rows ?? []).map((row) => openJob(row.id, row.payload)).filter((job) =>
    job.ownerId === owner && job.kind === "extraction" && /^telegram:\d+$/.test(job.messageId) && !job.work &&
    job.today === hkToday(at) && isClientNote(job.text) && hashName(job.text.trim().split(/\s+/u)[0]) === nameHash);
  if (sources.length !== 1) return reportRecoveryBlock("original not uniquely matched");
  const original = sources[0];

  const terminalId = jobId(`${original.messageId}:tool:${MAX_TOOL_STEPS}`);
  const { data: terminal, error: terminalError } = await db.from("wa_drafts").select("payload").eq("owner_id", owner)
    .eq("id", terminalId).maybeSingle();
  if (terminalError) throw Error("Could not verify research limit");
  if (!terminal) return reportRecoveryBlock("research limit record missing");
  const stopped = openJob(terminalId, terminal.payload);
  if (stopped.state !== "done" || stopped.work?.rootMessageId !== original.messageId ||
      stopped.work.step !== MAX_TOOL_STEPS || stopped.text !== original.text ||
      !stopped.work.observations.every((item) => ["web_search", "open_url", "accuracy_check"].includes(item.tool))) return reportRecoveryBlock("research limit not verified");

  const [agent, names, pending] = await Promise.all([
    resolveTelegramAgent(db, original.from), loadClientNames(db, owner), latestPending(db, owner),
  ]);
  if (agent?.id !== owner) return reportRecoveryBlock("Telegram binding changed");
  if (matchClient(original.text.trim().split(/\s+/u)[0], names).mode !== "new") return reportRecoveryBlock("client already exists");
  const job: Job = {
    kind: "extraction", ownerId: owner, from: original.from, messageId: recoveryId,
    text: original.text.trim().slice(0, 4000), texts: original.text.trim().slice(0, 4000),
    today: original.today, expectedDraftId: pending?.draft.channel === "telegram" ? pending.id : null,
    recoveryNameHash: nameHash,
  };
  await enqueueJob(db, job);
  console.info("Original Telegram note recovery queued");
}

export async function noteRecoveryState(db: SupabaseClient) {
  if (!process.env.ZEST_NOTE_RECOVERY) return { state: "disabled" };
  const { owner, sentAt } = setting.parse(JSON.parse(process.env.ZEST_NOTE_RECOVERY));
  const id = jobId(`telegram-note-recovery:${owner}:${sentAt}`);
  const { data, error } = await db.from("wa_drafts").select("payload,created_at").eq("id", id).eq("owner_id", owner).maybeSingle();
  if (error) throw Error("Could not read recovery state");
  if (!data) return { state: "not_queued" };
  const job = openJob(id, data.payload);
  return { state: job.state, queuedAt: data.created_at, updatedAt: job.updated ?? null };
}
