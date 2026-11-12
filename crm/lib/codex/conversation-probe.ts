import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Extraction } from "../whatsapp/schema";
import { jobId, openJob } from "./jobs";

export const CONVERSATION_PROBE_ID = "coach-conversation-v3";
export const CONVERSATION_PROBE_TEXT = "7乘8係幾多？順便按我覆緊嗰句，草擬一句自然嘅廣東話道謝短訊。請簡短回答。";
export const CONVERSATION_PROBE_QUOTE = "今日係Mary幫咗我，我想多謝佢抽時間幫忙。";
export function conversationProbePassed(result: Extraction) {
  return result.response?.kind === "chat" && /56/.test(result.response.text) && /Mary/.test(result.response.text) &&
    /多謝|唔該|感謝/.test(result.response.text) && result.response.text.length < 600 &&
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
