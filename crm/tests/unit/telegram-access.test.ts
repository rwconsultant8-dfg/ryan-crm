import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePrivateMessage, verifyWebhookSecret, sendTelegramText } from "@/lib/telegram/transport";
import { resolveTelegramAgent, validTelegramId } from "@/lib/telegram/registry";

const update = { update_id: 42, message: { message_id: 7, text: "確認", chat: { id: 12345, type: "private" }, from: { id: 12345, is_bot: false } } };
function adminFor(users: {id:string; app_metadata:Record<string,unknown>}[], active = true) {
  const profile = { maybeSingle: vi.fn(async () => ({ data: {id:"owner",active},error:null })), eq() { return this; }, select() { return this; } };
  return { auth: { admin: { listUsers: vi.fn(async () => ({data:{users},error:null})) } }, from:vi.fn(() => profile) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Telegram webhook trust boundary", () => {
  it("requires the configured exact secret", () => {
    expect(verifyWebhookSecret(null,"secret")).toBe(false);
    expect(verifyWebhookSecret("secret",undefined)).toBe(false);
    expect(verifyWebhookSecret("wrong!","secret")).toBe(false);
    expect(verifyWebhookSecret("secret","secret")).toBe(true);
  });
  it("namespaces genuine private user updates for deduplication", () => {
    expect(parsePrivateMessage(update)).toEqual({from:"12345",messageId:"telegram:42",telegramMessageId:7,type:"text",text:"確認"});
  });
  it("rejects group chats, forged sender IDs, bots and malformed identifiers", () => {
    for (const patch of [{chat:{id:12345,type:"group"}},{chat:{id:999,type:"private"}},{from:{id:12345,is_bot:true}},{from:{id:"12345",is_bot:false}}]) {
      expect(parsePrivateMessage({...update,message:{...update.message,...patch}})).toBeNull();
    }
    expect(parsePrivateMessage({...update,update_id:-1})).toBeNull();
    expect(parsePrivateMessage(null)).toBeNull();
  });
  it("does not interpret attachments as text commands", () => {
    expect(parsePrivateMessage({...update,message:{...update.message,text:undefined}})?.type).toBe("unsupported");
  });
  it("sends previews as plain text without truncating long content", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN","unit-test-token");
    const fetchMock=vi.fn(async () => ({ok:true}));vi.stubGlobal("fetch",fetchMock);
    const body="客".repeat(4100);await sendTelegramText("12345",body);
    const parts=fetchMock.mock.calls.map(call=>JSON.parse((call as unknown as [string,RequestInit])[1].body as string));
    expect(parts.map(p=>p.text).join("")).toBe(body);expect(parts).toHaveLength(2);
    expect(parts.every(p=>p.chat_id==="12345"&&!p.parse_mode)).toBe(true);
  });
});
describe("Telegram ownership", () => {
  it("accepts numeric account IDs, rejecting usernames and unsafe integers", () => {
    expect(validTelegramId("12345")).toBe(true);
    for(const id of ["@ryan","0","-1","9007199254740992","12 34"]) expect(validTelegramId(id)).toBe(false);
  });
  it("resolves exactly one active employee through admin metadata", async () => {
    const admin=adminFor([{id:"owner",app_metadata:{telegram_user_id:"12345"}}]);
    expect(await resolveTelegramAgent(admin as unknown as SupabaseClient,"12345")).toEqual({id:"owner"});
    expect(admin.from).toHaveBeenCalledWith("profiles");
  });
  it("blocks unknown, duplicate and disabled accounts", async () => {
    for(const admin of [adminFor([]),adminFor([{id:"a",app_metadata:{telegram_user_id:"12345"}},{id:"b",app_metadata:{telegram_user_id:"12345"}}]),adminFor([{id:"owner",app_metadata:{telegram_user_id:"12345"}}],false)]) {
      expect(await resolveTelegramAgent(admin as unknown as SupabaseClient,"12345")).toBeNull();
    }
  });
});
