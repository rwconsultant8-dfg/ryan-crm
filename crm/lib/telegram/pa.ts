import "server-only";
import { enqueueJob } from "../codex/jobs";
import { createAdminClient } from "../supabase/admin";
import type { Incoming } from "../whatsapp/handle";
import { hkToday } from "../weeks";
import { paAllowed, paToken } from "./config";
import { resolveTelegramAgent } from "./registry";
import { downloadTelegramFile, sendTelegramText, sendTelegramDocument, reactTelegramMessage } from "./transport";
import { fileScope, listBotFiles, readBotFile, saveBotFile } from "./files";

export async function handlePAIncoming(message: Incoming) {
  // Reject everybody else before reading any user, file, draft or CRM data.
  if (!paAllowed(message.from)) return;
  const admin = createAdminClient(), token = paToken();
  if (!token) return;
  const send = (text:string) => sendTelegramText(message.from, text, token, message.telegramMessageId);
  const agent = await resolveTelegramAgent(admin, message.from);
  if (!agent) return send("Ryan，請先請主管將你嘅 Telegram ID 綁定 CRM 員工帳戶。綁定完成後，我先可以安全保存你嘅私人對話同讀取你嘅工作安排。");
  const messageId = message.messageId.replace(/^telegram:/, "telegram-pa:");
  const seen = await admin.from("wa_seen_messages").insert({message_id:messageId});
  if (seen.error?.code === "23505") return;
  if (seen.error) throw new Error("未能核對 PA 訊息");
  const scope = fileScope("pa", message.from);
  if (message.type === "file") {
    try {
      const body = await downloadTelegramFile(message, token);
      await saveBotFile(admin, scope, message.fileName || "file", body, message.mimeType);
      return send("已存入 Ryan 私人 PA 嘅 File。同事用嘅 ZEST 團隊助手 嘅 File 同對話唔會混入呢度。呢份附件未有自動修改 CRM；你可以再講想我點樣幫你。");
    } catch { return send("附件未能儲存，請稍後重試（最多 10 MB）。"); }
  }
  if (message.type !== "text") return send("Ryan，可以直接傳文字、相片或文件俾我。語音可先用手機鍵盤轉成文字。");
  const text = message.text.trim();
  if (/^\/start(?:@\w+)?(?:\s.*)?$|^\/help(?:@\w+)?$/i.test(text)) return send("Ryan，我係你一對一 PA。可以幫你整理工作優先次序、讀取你未來一週嘅 CRM 待辦、準備跟進訊息同儲存私人文件。\n/files 睇私人檔案；/get 檔案代號 取回文件。\n同事更新客戶請用 ZEST 團隊助手；呢邊唔會自動改客戶資料。");
  if (/^\/files(?:@\w+)?$/i.test(text)) {
    const files = await listBotFiles(admin, scope);
    return send(files.length ? files.map(f=>`${f.name}\n/get ${f.key}`).join("\n\n") : "你嘅私人 PA File 暫時未有檔案。");
  }
  const requested = text.match(/^\/get(?:@\w+)?\s+(.+)$/i)?.[1];
  if (requested) {
    try {
      const file = await readBotFile(admin, scope, requested);
      await sendTelegramDocument(message.from, file, "", token);
      return;
    } catch { return send("搵唔到你嘅檔案，或者暫時未能傳送。可以先用 /files 核對代號。"); }
  }
  if (!text) return;
  if (message.telegramMessageId) {
    try { await reactTelegramMessage(message.from, message.telegramMessageId, token); }
    catch { console.error("PA receipt reaction unavailable"); }
  }
  try {
    await enqueueJob(admin, {
      kind: "pa",
      ownerId: agent.id,
      from: message.from,
      messageId,
      text: text.slice(0, 4000),
      texts: text.slice(0, 4000),
      today: hkToday(),
      expectedDraftId: null,
      telegramMessageId: message.telegramMessageId,
      quotedText: message.quotedText,
      receivedAt: Date.now(),
    });
  } catch {
    return send("Ryan，暫時未能處理呢段訊息，請稍後再試。");
  }
}
