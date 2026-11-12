import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePrivateMessage, verifyWebhookSecret, sendTelegramText, reactTelegramMessage } from "@/lib/telegram/transport";
import { resolveTelegramAgent, listTelegramLinks } from "@/lib/telegram/registry";
import type { SupabaseClient } from "@supabase/supabase-js";

const incoming = { update_id: 42, message: { message_id: 5, text: "確認", chat: { id: 123456789, type: "private" }, from: { id: 123456789, is_bot: false } } };
describe("Telegram transport boundaries", () => {
  it("requires the configured webhook secret, including missing/unequal-length cases", () => {
    expect(verifyWebhookSecret("right", "right")).toBe(true);
    for (const h of [null, "", "wrong", "right-more"]) expect(verifyWebhookSecret(h, "right")).toBe(false);
    expect(verifyWebhookSecret("right", undefined)).toBe(false);
  });
  it("uses the authenticated private sender ID and namespaces replay IDs", () => {
    expect(parsePrivateMessage(incoming)).toEqual({ from: "123456789", messageId: "telegram:42", telegramMessageId:5, type: "text", text: "確認" });
    expect(parsePrivateMessage({ ...incoming, message: { ...incoming.message, text: undefined } })?.type).toBe("unsupported");
  });
  it("ignores groups, bots, forged chat identities, invalid update IDs and malformed updates", () => {
    const cases = [null, {}, { ...incoming, update_id: "42" }, { ...incoming, update_id: -1 },
      { ...incoming, message: { ...incoming.message, chat: { id: 123456789, type: "group" } } },
      { ...incoming, message: { ...incoming.message, from: { id: 7, is_bot: false } } },
      { ...incoming, message: { ...incoming.message, from: { id: 123456789, is_bot: true } } }];
    for (const value of cases) expect(parsePrivateMessage(value)).toBeNull();
  });
  it("keeps same-chat replies as context and ignores quotes from another chat", () => {
    const reply = {text:"邊份文件？",chat:incoming.message.chat,from:{id:2,is_bot:true}};
    const update = {...incoming,message:{...incoming.message,reply_to_message:reply}};
    expect(parsePrivateMessage(update)?.quotedText).toBe(reply.text);
    expect(parsePrivateMessage({...update,message:{...update.message,reply_to_message:{...reply,chat:{id:7,type:"private"}}}})?.quotedText).toBeUndefined();
  });
  it("reacts to the original message with a small thumbs-up instead of sending an emoji message",async()=>{
    const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetcher);
    try{await reactTelegramMessage('123456789',5,'test-token');expect(fetcher.mock.calls[0][0]).toContain('/setMessageReaction');expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({chat_id:'123456789',message_id:5,reaction:[{type:'emoji',emoji:'👍'}],is_big:false});}finally{vi.unstubAllGlobals();}
  });
  it("sends the whole confirmation preview as plain text, without truncation", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetcher = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetcher);
    try {
      const text = "<客戶>".repeat(1800);
      await sendTelegramText("123456789", text);
      const bodies = fetcher.mock.calls.map(c => JSON.parse(c[1].body));
      expect(bodies.map(b => b.text).join("")).toBe(text);
      expect(bodies.every(b => b.chat_id === "123456789" && !b.parse_mode)).toBe(true);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
function registry(users: { id: string; app_metadata: object }[], active = true) {
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "staff-a", active }, error: null }) };
  return { auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users }, error: null }) } }, from: vi.fn().mockReturnValue(q), q };
}
describe("Telegram staff ownership", () => {
  it("maps only trusted app metadata and checks current active profile", async () => {
    const admin = registry([{ id: "staff-a", app_metadata: { telegram_user_id: "123456789" } }]);
    expect(await resolveTelegramAgent(admin as unknown as SupabaseClient, "123456789")).toEqual({ id: "staff-a" });
    expect(admin.q.eq).toHaveBeenCalledWith("id", "staff-a");
    expect(await resolveTelegramAgent(registry([{ id: "staff-a", app_metadata: { telegram_user_id: "123456789" } }], false) as unknown as SupabaseClient, "123456789")).toBeNull();
  });
  it("fails closed for unbound and duplicate identities", async () => {
    const admin = registry(["staff-a", "staff-b"].map(id => ({ id, app_metadata: { telegram_user_id: "123456789" } })));
    expect(await resolveTelegramAgent(admin as unknown as SupabaseClient, "123456789")).toBeNull();
    expect(await resolveTelegramAgent(admin as unknown as SupabaseClient, "987654321")).toBeNull();
    expect(admin.from).not.toHaveBeenCalled();
  });
  it("does not silently treat registry failures as an empty binding list", async () => {
    const admin = registry([]); admin.auth.admin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: "offline" } } as never);
    await expect(listTelegramLinks(admin as unknown as SupabaseClient)).rejects.toThrow();
  });
});
