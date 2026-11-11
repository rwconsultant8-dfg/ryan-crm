import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileScope, listBotFiles, readBotFile, saveBotFile } from "./files";
import type { Draft } from "../whatsapp/apply";
import {appointmentTimeLabel} from "../activity";

export type CoachTurn = { user: string; assistant: string };

export async function loadCoachConversation(admin: SupabaseClient, ownerId: string): Promise<CoachTurn[]> {
  const scope = fileScope("coach", ownerId);
  const files = (await listBotFiles(admin, scope)).filter((file) => file.name.startsWith("AI對話-") && Date.parse(file.created_at || "") > Date.now() - 24 * 3600_000).slice(0, 6).reverse();
  const turns = await Promise.all(files.map(async (file) => {
    try {
      const turn: unknown = JSON.parse((await readBotFile(admin, scope, file.key)).body.toString());
      if (turn && typeof turn === "object" && "user" in turn && "assistant" in turn && typeof turn.user === "string" && typeof turn.assistant === "string") {
        return { user: turn.user.slice(0, 2000), assistant: turn.assistant.slice(0, 2000) };
      }
    } catch { /* A broken older turn must not prevent a new answer. */ }
    return null;
  }));
  return turns.filter((turn): turn is CoachTurn => turn !== null);
}

export async function deliverCoachReply(admin: SupabaseClient, ownerId: string, to: string, user: string, answer: string, send: (to: string, text: string) => Promise<void>) {
  const reply = answer.trim().slice(0, 3000) || "可以講多少少，你想我幫你處理邊一部分？";
  try {
    await saveBotFile(admin, fileScope("coach", ownerId), `AI對話-${new Date().toISOString()}.json`, Buffer.from(JSON.stringify({ user: user.slice(0, 4000), assistant: reply })), "application/json");
  } catch { console.error("Coach conversation storage unavailable"); }
  await send(to, reply);
}

/** Only describe successful writes after the app has returned a receipt. */
export function savedCoachReply(draft: Draft): string {
  const extraction = draft.extraction;
  const name = draft.target.mode === "existing" || draft.target.mode === "new" ? draft.target.name : "";
  const tasks = extraction.tasks ?? [];
  const lines = [name ? `已幫你記低「${name}」${extraction.meeting?.occurred ? "嘅見面重點" : "嘅資料"}。` : ""];
  if (tasks.length) {
    lines.push(...tasks.slice(0, 3).map((task) => `已${task.operation === "reschedule" ? "改好" : "記低"}「${task.name}」：${task.new_day || task.day}${appointmentTimeLabel(task.time,task.period) ? ` ${appointmentTimeLabel(task.time,task.period)}` : ""}${task.plan ? `，${task.plan.slice(0, 100)}` : ""}。`));
    if (tasks.length > 3) lines.push(`其餘 ${tasks.length - 3} 項安排亦已記低。`);
  }
  if (!name && !tasks.length) lines.push("已幫你記低，可以喺 app 睇返。");
  if (extraction.response?.text.trim()) lines.push(extraction.response.text.trim());
  return lines.filter(Boolean).join("\n");
}
