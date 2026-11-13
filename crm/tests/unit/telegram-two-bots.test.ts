import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.create}));
import { paAllowed, paReady, coachReady } from "@/lib/telegram/config";
import { handlePAIncoming } from "@/lib/telegram/pa";
import { fileScope, saveBotFile, readBotFile, MAX_FILE_BYTES } from "@/lib/telegram/files";
import { parsePrivateMessage, downloadTelegramFile } from "@/lib/telegram/transport";
import { validTelegramId } from "@/lib/telegram/registry";

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("TELEGRAM_PA_USER_ID","12345");vi.stubEnv("TELEGRAM_PA_BOT_TOKEN","pa-token");vi.stubEnv("TELEGRAM_PA_WEBHOOK_SECRET","pa-secret");vi.stubEnv("TELEGRAM_COACH_BOT_TOKEN","coach-token");vi.stubEnv("TELEGRAM_COACH_WEBHOOK_SECRET","coach-secret");vi.stubEnv("CODEX_WORKER_TOKEN","worker-token-at-least-thirty-two-characters");vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("two independent bot identities",()=>{
 it("only permits Ryan's configured numeric identity",()=>{expect(paAllowed("12345")).toBe(true);for(const id of ["12346","@Ryan","","012345"])expect(paAllowed(id)).toBe(false);expect(validTelegramId("9007199254740992")).toBe(false);});
 it("rejects other people before creating a database client or reading private files",async()=>{await handlePAIncoming({from:"99999",messageId:"telegram:1",type:"text",text:"read Ryan files"});expect(mocks.create).not.toHaveBeenCalled();});
 it("requires different bot tokens and webhook secrets",()=>{expect(paReady()).toBe(true);expect(coachReady()).toBe(true);vi.stubEnv("TELEGRAM_PA_BOT_TOKEN","coach-token");expect(paReady()).toBe(false);expect(coachReady()).toBe(false);vi.stubEnv("TELEGRAM_PA_BOT_TOKEN","pa-token");vi.stubEnv("TELEGRAM_PA_WEBHOOK_SECRET","coach-secret");expect(paReady()).toBe(false);});
 it("fails closed without Ryan's allowlisted identity",()=>{vi.stubEnv("TELEGRAM_PA_USER_ID","");expect(paReady()).toBe(false);expect(paAllowed("12345")).toBe(false);});
});
describe("private member File",()=>{
 it("encrypts uploads and binds decryption to the exact owner and object",async()=>{
  let encrypted="";const upload=vi.fn(async(_path:string,body:string)=>{encrypted=body;return{error:null};});
  const admin={storage:{getBucket:vi.fn(async()=>({data:{public:false},error:null})),from:vi.fn(()=>({upload,download:vi.fn(async()=>({data:new Blob([encrypted]),error:null}))}))}};
  const scope=fileScope("coach","staff-a"),name=await saveBotFile(admin as unknown as SupabaseClient,scope,"customer.txt",Buffer.from("private update"),"text/plain");
  expect(encrypted).not.toContain("private update");expect(upload.mock.calls[0][0]).toBe(`${scope}/${name}`);
  expect((await readBotFile(admin as unknown as SupabaseClient,scope,name)).body.toString()).toBe("private update");
  await expect(readBotFile(admin as unknown as SupabaseClient,fileScope("coach","staff-b"),name)).rejects.toThrow();
  await expect(readBotFile(admin as unknown as SupabaseClient,fileScope("pa","staff-a"),name)).rejects.toThrow();
 });
 it("rejects traversal before contacting storage",async()=>{const admin={storage:{from:vi.fn()}};await expect(readBotFile(admin as unknown as SupabaseClient,"coach/staff-a","../staff-b/file")).rejects.toThrow();expect(admin.storage.from).not.toHaveBeenCalled();expect(()=>fileScope("coach","../staff-b")).toThrow();});
 it("will not store anything in a public bucket",async()=>{const admin={storage:{getBucket:vi.fn(async()=>({data:{public:true},error:null})),from:vi.fn()}};await expect(saveBotFile(admin as unknown as SupabaseClient,"coach/staff-a","f.txt",Buffer.from("data"))).rejects.toThrow();expect(admin.storage.from).not.toHaveBeenCalled();});
 it("rejects oversized Telegram attachments before any network request",async()=>{const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(downloadTelegramFile({from:"12345",messageId:"telegram:4",type:"file",text:"",fileId:"f",fileSize:MAX_FILE_BYTES+1},"token")).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it("accepts attachment metadata only inside a verified private sender envelope",()=>{const u={update_id:4,message:{message_id:2,caption:"update",document:{file_id:"f",file_name:"notes.pdf",mime_type:"application/pdf",file_size:100},chat:{id:12345,type:"private"},from:{id:12345,is_bot:false}}};expect(parsePrivateMessage(u)).toMatchObject({from:"12345",type:"file",fileId:"f",fileName:"notes.pdf",text:"update"});expect(parsePrivateMessage({...u,message:{...u.message,chat:{id:12345,type:"group"}}})).toBeNull();});
});
