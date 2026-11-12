import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPT_SLOTS, appointmentTimeLabel } from "../activity";
import { apptRecordId } from "../activity-data";
import { calendarEntries, validTime } from "../followups";
import { decryptColumn } from "../secure";
import { openDraft } from "../whatsapp/drafts";
import { hkToday } from "../weeks";
import { listTelegramLinks, resolveTelegramAgent, validTelegramId } from "./registry";
import { isMomoAvatarAccount } from "../member-identity";

const crm = "https://ryan-crm-chi.vercel.app";
const hour = 60 * 60 * 1000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function briefAuthorized(header: string | null, hash = process.env.ZEST_BRIEF_TOKEN_HASH) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(header ?? "")?.[1];
  if (!token || !hash || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(sha256(token), "hex"), Buffer.from(hash, "hex"));
}

export function briefDay(now: number, test: boolean) {
  if (test) return hkToday(now);
  const localTime = new Date(now + 8 * hour).toISOString().slice(11, 16);
  return localTime >= "09:30" && localTime < "10:30" ? hkToday(now) : null;
}

export function briefDeliveryKey(mode: string, day: string, requestIds: string[]) {
  if (requestIds.length === 0 && mode !== "preview") return `zest-ryan-brief-v1:${mode}:${day}`;
  if ((mode !== "test" && mode !== "preview") || requestIds.length !== 1 || !/^[a-f0-9]{32}$/.test(requestIds[0])) return null;
  return `zest-ryan-brief-v1:${mode}:manual:${requestIds[0]}`;
}

export async function verifyBriefRecipient(db: SupabaseClient) {
  const config = process.env.ZEST_BRIEF_RECIPIENT ?? "";
  const [id, emailHash] = config.split(":");
  if (!validTelegramId(id) || !/^[a-f0-9]{64}$/.test(emailHash ?? "")) throw Error("Recipient configuration missing");
  const agent = await resolveTelegramAgent(db, id);
  if (!agent) throw Error("Recipient binding unavailable");
  const { data, error } = await db.from("profiles").select("email").eq("id", agent.id).eq("role", "admin").eq("active", true).maybeSingle();
  if (error || !data || sha256(data.email.trim().toLowerCase()) !== emailHash) throw Error("Recipient binding unavailable");
  return id;
}

export async function verifyMomoPreviewRecipient(db: SupabaseClient) {
  const { data, error } = await db.from("profiles").select("id,email").eq("role", "admin").eq("active", true);
  if (error) throw Error("Preview account unavailable");
  const matches = (data ?? []).filter((profile) => isMomoAvatarAccount(profile.email));
  if (matches.length !== 1) throw Error("Preview account unavailable");

  const links = await listTelegramLinks(db);
  const id = links.get(matches[0].id);
  if (!id || [...links.values()].filter((linkedId) => linkedId === id).length !== 1) {
    throw Error("Preview Telegram binding unavailable");
  }
  return id;
}

type Entry = { owner: string; time: string };
type Update = { owner: string; status: "pending" | "clarify" | "applied" };
const slots = new Map<string, string>(APPT_SLOTS.map((s) => [s.label, s.time.slice(0, 5)]));
const byTime = (a: string, b: string) => (slots.get(a) ?? a).localeCompare(slots.get(b) ?? b);
const clean = (name: string) => name.replace(/[\s\u202A-\u202E\u2066-\u2069]+/gu, " ").trim().slice(0, 45) || "同事";

export function renderMorningBrief(day: string, staff: Map<string, string>, appointments: Entry[], updates: Update[], test: boolean) {
  const schedule = new Map<string, Set<string>>();
  for (const a of appointments) {
    if (!staff.has(a.owner)) continue;
    const times = schedule.get(a.owner) ?? new Set<string>();
    times.add(a.time);
    schedule.set(a.owner, times);
  }
  const statuses = new Map<string, { pending: number; clarify: number; applied: number }>();
  for (const u of updates) {
    if (!staff.has(u.owner)) continue;
    const counts = statuses.get(u.owner) ?? { pending: 0, clarify: 0, applied: 0 };
    counts[u.status]++;
    statuses.set(u.owner, counts);
  }
  const name = (id: string) => clean(staff.get(id) ?? "");
  const list = (rows: string[], empty: string) => {
    if (!rows.length) return empty;
    const limited = rows.slice(0, 8).map((row) => "• " + row);
    if (rows.length > limited.length) limited.push("其餘請喺 CRM 查看。");
    return limited.join("\n");
  };
  const a = [...schedule].map(([id, times]) => {
    const sorted = [...times].sort(byTime);
    return `${name(id)}：${sorted.slice(0, 6).join("、")}${sorted.length > 6 ? "等" : ""}`;
  });
  const u = [...statuses].map(([id, c]) => `${name(id)}：${[c.applied && `${c.applied} 項已入 CRM`, c.pending && `${c.pending} 項待同事確認`, c.clarify && `${c.clarify} 項待同事補資料`].filter(Boolean).join("、")}`);
  return [
    `Ryan，${day} ZEST 團隊更新${test ? "（試發）" : ""}`,
    `今日約見\n${list(a, "CRM 暫未有約見記錄。")}`,
    `過去 24 小時同事更新\n${list(u, "CRM 暫未有新增更新記錄。")}`,
    `團隊日曆：${crm}/activity\n同事更新：${crm}/updates\n每日任務：${crm}/today`,
  ].join("\n\n");
}

export async function loadMorningBrief(db: SupabaseClient, day: string, now: number, test: boolean) {
  const [profiles, days, tasks, drafts] = await Promise.all([
    db.from("profiles").select("id,full_name").eq("active", true).order("full_name").limit(1000),
    db.from("activity_days").select("owner_id,day,appts").eq("day", day).limit(1000),
    db.from("daily_tasks").select("id,owner_id,info").eq("day", day).eq("category", "appointment").in("status", ["planned", "blocked", "done"]).limit(1000),
    db.from("wa_drafts").select("id,owner_id,status,payload").in("status", ["pending", "applied"]).gte("created_at", new Date(now - 24 * hour).toISOString()).lte("created_at", new Date(now).toISOString()).order("created_at", { ascending: false }).limit(1000),
  ]);
  if ([profiles, days, tasks, drafts].some((r) => r.error || !r.data || r.data.length >= 1000)) throw Error("Incomplete CRM read");
  const staff = new Map<string, string>(profiles.data!.map((p) => [p.id, p.full_name ?? ""]));
  const appointments: Entry[] = [];
  const timeLabel = (time: string, fallback: string) => time && validTime(time) ? time : fallback;
  for (const row of days.data!) {
    if (!staff.has(row.owner_id)) continue;
    const appts = decryptColumn(apptRecordId(row.owner_id, row.day), "appts", row.appts);
    if (Object.values(appts).includes("⚠️（無法解密）")) throw Error("Incomplete calendar read");
    for (const a of calendarEntries([{ day, appts }], APPT_SLOTS)) {
      appointments.push({ owner: row.owner_id, time: timeLabel(a.time, a.label) });
    }
  }
  for (const row of tasks.data!) {
    if (!staff.has(row.owner_id)) continue;
    const { time, period } = decryptColumn(row.id, "info", row.info);
    if ([time, period].includes("⚠️（無法解密）")) throw Error("Incomplete schedule read");
    appointments.push({ owner: row.owner_id, time: appointmentTimeLabel(timeLabel(time, ""), period) || "未記錄時間" });
  }
  const updates: Update[] = [];
  for (const row of drafts.data!) {
    if (!staff.has(row.owner_id) || /^(codex-job-v1|coach-action-v1)\./.test(row.payload)) continue;
    const draft = openDraft(row.id, row.payload);
    if (draft.channel === "telegram" && (row.status === "pending" || row.status === "applied")) {
      const status = row.status === "pending" && draft.extraction?.clarification?.trim() ? "clarify" : row.status;
      updates.push({ owner: row.owner_id, status });
    }
  }
  return renderMorningBrief(day, staff, appointments, updates, test);
}
