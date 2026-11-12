import "server-only";
import { createAdminClient } from "../supabase/admin";
import { processIncoming, type Incoming } from "../whatsapp/handle";
import { resolveTelegramAgent } from "./registry";
import { downloadTelegramFile, sendTelegramText, sendTelegramDocument, reactTelegramMessage } from "./transport";
import { resolveCoachToken } from "./credentials";
import { recoverCoachNote } from "./conversation";
import { fileScope, saveBotFile, readBotFile, listBotFiles } from "./files";

export async function handleTelegramIncoming(message: Incoming) {
  const admin = createAdminClient();
  const { error } = await admin.from("wa_seen_messages").insert({ message_id: message.messageId });
  if (error?.code === "23505") return;
  if (error) throw new Error("未能核對 Telegram 訊息");
  const agent = await resolveTelegramAgent(admin, message.from);
  if (!agent) return sendTelegramText(message.from, `你嘅 Telegram 帳戶 ID：${message.from}\n請交俾主管喺 CRM「員工帳戶」綁定。未綁定或已停用嘅帳戶唔可以存取客戶資料。`);
  if(message.telegramMessageId){
    try{await reactTelegramMessage(message.from,message.telegramMessageId);}catch{console.error("Telegram receipt reaction unavailable");}
  }
  const scope = fileScope("coach", agent.id);
  if (message.type === "file") {
    try {
      const body = await downloadTelegramFile(message, (await resolveCoachToken())!);
      const key=await saveBotFile(admin, scope, message.fileName || "file", body, message.mimeType);
      await sendTelegramText(message.from, "檔案已保存。可以叫我OCR、整理內容、修改PPTX文字或按提供資料填表。" );
      if (!message.text.trim()) return;
      message = { ...message, type:"text",text:`${message.text}\n[本次上傳檔案：${message.fileName||"file"}；fileKey：${key}]` };
    } catch { return sendTelegramText(message.from, "檔案未能儲存（最多 10 MB），請稍後重試。客戶資料未有改動。"); }
  }
  if (message.type !== "text") return sendTelegramText(message.from, "可以傳文字、相片或文件。語音可先用手機鍵盤轉成文字。");
  const text = message.text.trim();
  if (/^\/get(?:@\w+)?\s+/i.test(text)) {
    const key=text.replace(/^\/get(?:@\w+)?\s+/i,"").trim();
    const files=await listBotFiles(admin,scope);
    const file=files.find(x=>x.key===key && !/^(AI對話-|訊息-|工具紀錄-)/.test(x.name));
    if(!file)return sendTelegramText(message.from,"搵唔到你自己嘅檔案。可以用 /files 睇返。");
    await sendTelegramDocument(message.from,await readBotFile(admin,scope,key));return;
  }
  if (/^\/files(?:@\w+)?$/i.test(text)) return sendTelegramText(message.from, `${process.env.APP_URL || "https://ryan-crm-chi.vercel.app"}/files\n登入後只會顯示你自己嘅檔案。`);
  if (/^\/start(?:@\w+)?(?:\s.*)?$|^\/help(?:@\w+)?$/i.test(text)) message = { ...message, text: "幫助" };
  else if (!/^(確認|确认|confirm|ok|yes|1|取消|cancel|no|2)$/i.test(text)) {
    const recovered = await recoverCoachNote(admin, agent.id, text).catch(() => null);
    try { await saveBotFile(admin, scope, `訊息-${new Date().toISOString().replace(/[:.]/g,"-")}.txt`, Buffer.from(recovered ?? text)); }
    catch { return sendTelegramText(message.from, "暫時未能處理呢段訊息，請稍後再試。"); }
    if (recovered) message = { ...message, text: recovered };
  }
  await processIncoming(message, agent.id, admin, sendTelegramText, "telegram");
}
