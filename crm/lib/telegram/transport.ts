import "server-only";
import { timingSafeEqual } from "node:crypto";
import { resolveCoachToken } from "./credentials";
import { MAX_FILE_BYTES } from "./files";
import type { Incoming } from "../whatsapp/handle";

export function verifyWebhookSecret(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(secret), actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type Attachment = { file_id?: unknown; file_name?: unknown; mime_type?: unknown; file_size?: unknown };
type QuotedMessage = { text?: unknown; caption?: unknown; chat?: {id?: unknown; type?: unknown}; from?: {id?: unknown; is_bot?: unknown} };
type Update = { update_id?: unknown; message?: { reply_to_message?: QuotedMessage; message_id?: unknown; text?: unknown; caption?: unknown; document?:Attachment; photo?:Attachment[]; chat?: { id?: unknown; type?: unknown }; from?: { id?: unknown; is_bot?: unknown } } };
export function parsePrivateMessage(raw: unknown): Incoming | null {
  if (!raw || typeof raw !== "object") return null;
  const update = raw as Update, message = update.message;
  if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0 || !message ||
      !Number.isSafeInteger(message.message_id) || message.chat?.type !== "private" ||
      !Number.isSafeInteger(message.from?.id) || Number(message.from?.id) <= 0 ||
      message.from?.is_bot !== false || message.chat.id !== message.from.id) return null;
  const quoted = message.reply_to_message;
  const quoteText = quoted?.chat?.type === "private" && quoted.chat.id === message.chat.id &&
    (quoted.from?.is_bot === true || quoted.from?.id === message.from.id)
      ? (typeof quoted.text === "string" ? quoted.text : typeof quoted.caption === "string" ? quoted.caption : "").trim().slice(0,2000)
      : "";
  const base = { from: String(message.from.id), messageId: `telegram:${update.update_id}`, telegramMessageId:Number(message.message_id), ...(quoteText ? { quotedText:quoteText } : {}) };
  const file = message.document || (Array.isArray(message.photo) ? message.photo.at(-1) : undefined);
  if (file && typeof file.file_id === "string" && file.file_id.length <= 512) return { ...base, type:"file", text:typeof message.caption === "string" ? message.caption : "", fileId:file.file_id, fileName:typeof file.file_name === "string" ? file.file_name : `photo-${message.message_id}.jpg`, mimeType:typeof file.mime_type === "string" ? file.mime_type : "image/jpeg", fileSize:typeof file.file_size === "number" ? file.file_size : undefined };
  return { ...base, type: typeof message.text === "string" ? "text" : "unsupported", text: typeof message.text === "string" ? message.text : "" };
}

export async function sendTelegramText(to: string, body: string, token?:string, replyTo?:number): Promise<void> {
  token ||= await resolveCoachToken();
  if (!token) throw new Error("Telegram 助手未設定");
  // Plain text avoids user-controlled Markdown/HTML; split without discarding the confirmation preview.
  const chunks = body.match(/[\s\S]{1,4000}/gu) ?? [""];
  for (const text of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: to, text, link_preview_options: { is_disabled: true },
        ...(Number.isSafeInteger(replyTo) && replyTo! > 0
          ? {reply_parameters:{message_id:replyTo,allow_sending_without_reply:true}} : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Telegram 回覆失敗（${response.status}）`);
  }
}

export async function downloadTelegramFile(message: Incoming, token: string) {
  if (!message.fileId || (message.fileSize ?? 0) > MAX_FILE_BYTES) throw new Error("檔案最多 10 MB");
  const response = await fetch(`https://api.telegram.org/bot${token}/getFile`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({file_id:message.fileId}), signal:AbortSignal.timeout(15000) });
  const info = await response.json();
  const path = info.result?.file_path;
  if (!response.ok || !info.ok || typeof path !== "string" || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").includes("..") || (info.result.file_size ?? 0) > MAX_FILE_BYTES) throw new Error("未能讀取 Telegram 檔案");
  const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal:AbortSignal.timeout(20000), redirect:"error" });
  if (!file.ok || !file.body) throw new Error("未能下載檔案");
  const reader = file.body.getReader(), chunks:Uint8Array[]=[]; let length=0;
  while (true) { const {done,value}=await reader.read(); if(done)break; length+=value.length; if(length>MAX_FILE_BYTES){await reader.cancel();throw new Error("檔案最多 10 MB");}chunks.push(value); }
  return Buffer.concat(chunks);
}

/** Upload only a server-held file to the verified private sender, never an arbitrary URL or recipient. */
export async function sendTelegramDocument(to:string,file:{name:string;body:Uint8Array;mime:string},caption="",token?:string):Promise<void>{
  token ||= await resolveCoachToken();
  if(!token)throw Error("Telegram助手未設定");
  if(!/^[1-9]\d{0,15}$/.test(to)||file.body.length>MAX_FILE_BYTES)throw Error("文件大小或收件人無效");
  const form=new FormData();form.set('chat_id',to);form.set('caption',caption.slice(0,1000));
  form.set('document',new Blob([Uint8Array.from(file.body)],{type:file.mime}),file.name.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,120));
  const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(25000)});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(`Telegram文件傳送失敗（${response.status}）`);
}

/** A small native reaction on the original user message; never a standalone emoji message. */
export async function reactTelegramMessage(to:string,messageId:number,token?:string){
  if(!/^[1-9]\d{0,15}$/.test(to)||!Number.isSafeInteger(messageId)||messageId<=0)throw Error("Invalid reaction target");
  token ||= await resolveCoachToken();if(!token)throw Error("Telegram助手未設定");
  const response=await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:to,message_id:messageId,reaction:[{type:'emoji',emoji:'👍'}],is_big:false}),signal:AbortSignal.timeout(8000)});
  const result=await response.json();if(!response.ok||!result.ok)throw Error('Telegram reaction unavailable');
}
