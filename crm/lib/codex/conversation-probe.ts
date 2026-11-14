import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Extraction } from "../whatsapp/schema";
import { jobId, openJob } from "./jobs";

export const TEAM_SCOPE_REPLY = "私人日常問題可以用你嘅私人助手。我呢邊幫你處理 ZEST 團隊工作。";

export const CONVERSATION_PROBE_ID = "coach-conversation-v4";
export const CONVERSATION_PROBE_TEXT = "我私人想揀一套週末睇嘅電影，有咩推介？";
export const CONVERSATION_PROBE_QUOTE = "呢個係我自己週末嘅私人安排。";
export function conversationProbePassed(result: Extraction) {
  return result.response?.kind === "chat" && result.response.text === TEAM_SCOPE_REPLY && result.response.text.length < 600 &&
    !/Peter|Codex|API|JSON|佇列|資料庫|後台/i.test(result.response.text) &&
    Object.values(result.client).every((value) => !value) && !result.client_names?.length && !result.fields.length &&
    !result.checks.length && !result.tasks?.length && !result.stage && !result.season && !result.meeting?.occurred && !result.appointment.slot;
}
export async function conversationProbeStatus(admin: SupabaseClient) {
  try {
    const id = jobId(CONVERSATION_PROBE_ID);
    const { data, error } = await admin.from("wa_drafts").select("payload").eq("id", id).maybeSingle();
    if (error) return "unavailable";
    if (!data) return "pending";
    const job = openJob(id, data.payload);
    return job.state === "done" ? "passed" : job.state ?? "pending";
  } catch { return "unavailable"; }
}
