import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Extraction } from "../whatsapp/schema";
import { jobId, openJob } from "./jobs";

export const CONVERSATION_PROBE_ID = "coach-conversation-v2";
export const CONVERSATION_PROBE_TEXT = "7乘8係幾多？順便幫我寫一句自然嘅廣東話短訊向Mary道謝，呢個只係草擬例子，唔使記錄客戶資料，亦唔好傳俾任何人。請簡短回答。";
export function conversationProbePassed(result: Extraction) {
  return result.response?.kind === "chat" && /56/.test(result.response.text) && /Mary/.test(result.response.text) &&
    /多謝|唔該|感謝/.test(result.response.text) && result.response.text.length < 600 &&
    !/Codex|API|JSON|佇列|資料庫|後台/i.test(result.response.text) &&
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
