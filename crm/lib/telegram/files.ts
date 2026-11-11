import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptValue, encryptValue, parseKey } from "../crypto";

const BUCKET = "ryan-bot-files";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export function fileScope(kind: "coach" | "pa", id: string) {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error("檔案身份無效");
  return `${kind}/${id}`;
}
function safeName(name: string) { return name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "_").slice(0, 120) || "file"; }
function displayName(stored: string) {
  const name=stored.replace(/^[0-9a-f-]{36}--/, "").replace(/\.enc$/, "");
  const encoded=name.match(/^v2_([A-Za-z0-9_-]+)$/)?.[1];
  if(encoded){
    const decoded=Buffer.from(encoded,"base64url").toString("utf8");
    if(Buffer.from(decoded).toString("base64url")===encoded)return safeName(decoded);
  }
  return name; // Existing ASCII filenames, including saved bot credentials.
}
function objectPath(scope: string, name: string) {
  if (!/^(coach|pa)\/[a-zA-Z0-9-]{1,64}$/.test(scope) || !name || name.length > 600 || /[\\/\u0000-\u001f]/.test(name) || name === "." || name === "..") throw new Error("檔案位置無效");
  return `${scope}/${name}`;
}
async function ensurePrivateBucket(admin: SupabaseClient) {
  const { data, error } = await admin.storage.getBucket(BUCKET);
  if (data) { if (data.public) throw new Error("檔案儲存區必須為私人"); return; }
  if (String((error as {statusCode?:string})?.statusCode) !== "404") throw new Error("未能驗證私人檔案區");
  const created = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 20 * 1024 * 1024 });
  if (created.error) {
    const retry = await admin.storage.getBucket(BUCKET);
    if (!retry.data || retry.data.public) throw new Error("未能建立私人檔案區");
  }
}
export async function saveBotFile(admin: SupabaseClient, scope: string, name: string, body: Uint8Array, mime = "application/octet-stream") {
  if (body.length > MAX_FILE_BYTES) throw new Error("檔案最多 10 MB");
  // Storage object keys must use ASCII; retain the original Unicode name in
  // the encrypted envelope and decode this versioned label for file listings.
  const storedName = `${randomUUID()}--v2_${Buffer.from(safeName(name)).toString("base64url")}.enc`, path = objectPath(scope, storedName);
  const encrypted = encryptValue(parseKey(process.env.DATA_ENCRYPTION_KEY), `bot-file:${path}`, JSON.stringify({ name: safeName(name), mime, body: Buffer.from(body).toString("base64") }));
  await ensurePrivateBucket(admin);
  const { error } = await admin.storage.from(BUCKET).upload(path, encrypted, { contentType: "text/plain", upsert: false });
  if (error) {
    const detail=error as {code?:string;status?:number;statusCode?:string};
    console.error("Bot file upload failed",{code:detail.code,status:detail.status || Number(detail.statusCode) || undefined});
    throw new Error("檔案未能儲存，請重試");
  }
  return storedName;
}
export async function listBotFiles(admin: SupabaseClient, scope: string) {
  objectPath(scope, "check");
  const bucket = await admin.storage.getBucket(BUCKET);
  if (bucket.error) { if (String((bucket.error as {statusCode?:string}).statusCode) === "404") return []; throw new Error("暫時未能讀取檔案區"); }
  if (!bucket.data || bucket.data.public) throw new Error("檔案區未設定為私人");
  const { data, error } = await admin.storage.from(BUCKET).list(scope, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
  if (error) { if (String((error as {statusCode?:string}).statusCode) === "404") return []; throw new Error("暫時未能讀取檔案"); }
  return (data ?? []).filter(f => f.id && f.name.endsWith(".enc")).map(f => ({ key: f.name, name: displayName(f.name), created_at: f.created_at }));
}
export async function readBotFile(admin: SupabaseClient, scope: string, name: string) {
  const path = objectPath(scope, name);
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("搵唔到你嘅檔案");
  const file = JSON.parse(decryptValue(parseKey(process.env.DATA_ENCRYPTION_KEY), `bot-file:${path}`, await data.text())) as { name:string;mime:string;body:string };
  return { name: safeName(file.name), mime: file.mime, body: Buffer.from(file.body, "base64") };
}
