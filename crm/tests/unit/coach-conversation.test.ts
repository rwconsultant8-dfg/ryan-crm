import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/lib/whatsapp/schema";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), status: vi.fn(), named: vi.fn(), list: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/whatsapp/drafts", () => ({ latestPending: mocks.latest, setStatus: mocks.status, sealDraft: vi.fn(), reopen: vi.fn() }));
vi.mock("@/lib/whatsapp/named-clients", () => ({ ensureNamedClients: mocks.named }));
vi.mock("@/lib/telegram/files", () => ({ fileScope: (kind: string, owner: string) => `${kind}/${owner}`, listBotFiles: mocks.list, readBotFile: mocks.read, saveBotFile: mocks.save }));
import { processIncoming } from "@/lib/whatsapp/handle";
import { deliverCoachReply, loadCoachConversation, recoverCoachNote, savedCoachReply } from "@/lib/telegram/conversation";
import { conversationProbePassed } from "@/lib/codex/conversation-probe";

const empty = (): Extraction => ({ client: { name: "", age: "", gender: "", occupation: "", marital: "" }, fields: [], checks: [], stage: "", season: "", activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 }, appointment: { slot: "", text: "" }, date: "2026-11-09", summary: "", tasks: [], response: { kind: "chat", text: "7 × 8 = 56。\nMary，多謝你今日抽時間同我傾！" } });
beforeEach(() => { vi.clearAllMocks(); mocks.latest.mockResolvedValue(null); mocks.save.mockResolvedValue("saved"); mocks.list.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());
describe("同事普通 AI 問答", () => {
  it("answers even with a pending update and never creates customers, updates drafts or applies extracted facts", async () => {
    mocks.latest.mockResolvedValue({ id: "pending", created_at: new Date().toISOString(), draft: { channel: "telegram", texts: ["Mary50歲"], target: { mode: "existing", id: "customer", name: "Mary" } } });
    const result = empty();
    result.client.name = "Mary"; result.fields = [{ field: "form_rr.family", text: "should never be saved" }];
    const extract = vi.fn().mockResolvedValue(result), send = vi.fn(), admin = { rpc: vi.fn(), from: vi.fn() };
    await processIncoming({ from: "123", messageId: "question", type: "text", text: "Mary話想諗下，我點覆好？" }, "staff-a", admin as never, send, "telegram", { today: "2026-11-09", extract });
    expect(send).toHaveBeenCalledWith("123", result.response!.text);
    expect(mocks.named).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled(); expect(admin.from).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(admin, "coach/staff-a", expect.any(String), expect.any(Buffer), "application/json");
  });
  it("acknowledges thanks naturally without invoking AI or changing an update", async () => {
    const send = vi.fn(), extract = vi.fn();
    await processIncoming({ from: "123", messageId: "thanks", type: "text", text: "唔該晒！" }, "staff-a", {} as never, send, "telegram", { today: "2026-11-09", extract });
    expect(send).toHaveBeenCalledWith("123", "唔使客氣，有需要隨時搵我。");
    expect(extract).not.toHaveBeenCalled(); expect(mocks.latest).not.toHaveBeenCalled();
  });
  it("keeps conversation reads scoped to one staff member and skips old or corrupted turns", async () => {
    mocks.list.mockResolvedValue([{ key: "new", name: "AI對話-new.json", created_at: new Date().toISOString() }, { key: "broken", name: "AI對話-broken.json", created_at: new Date().toISOString() }, { key: "old", name: "AI對話-old.json", created_at: "2020-01-01" }]);
    mocks.read.mockImplementation(async (_admin, _scope, key) => ({ body: Buffer.from(key === "new" ? JSON.stringify({ user: "問題", assistant: "答案" }) : "broken") }));
    expect(await loadCoachConversation({} as never, "staff-a")).toEqual([{ user: "問題", assistant: "答案" }]);
    expect(mocks.list).toHaveBeenCalledWith({}, "coach/staff-a");
    expect(mocks.read.mock.calls.every((call) => call[1] === "coach/staff-a")).toBe(true);
    expect(mocks.read).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "old");
  });
  it("still delivers a useful answer when conversation storage is temporarily unavailable", async () => {
    mocks.save.mockRejectedValue(new Error("storage")); const log = vi.spyOn(console, "error").mockImplementation(() => {}), send = vi.fn();
    try { await deliverCoachReply({} as never, "staff-a", "123", "問題", "答案", send); expect(send).toHaveBeenCalledWith("123", "答案"); } finally { log.mockRestore(); }
  });
  it("summarizes successful updates in plain language with the correct new appointment time", () => {
    const extraction = empty(); extraction.response = { kind: "update", text: "" };
    extraction.tasks = [{ operation: "reschedule", day: "2026-11-09", new_day: "2026-11-10", time: "15:30", category: "appointment", stage: "", name: "Mary", plan: "見面", status: "planned", result: "" }];
    const text = savedCoachReply({ channel: "telegram", texts: [], today: "2026-11-09", extraction, target: { mode: "none" } });
    expect(text).toContain("2026-11-10 15:30"); expect(text).not.toMatch(/Codex|API|JSON|佇列|資料庫|Profile/);
  });
  it("only passes the live probe for an accurate concise answer with no update fields", () => {
    expect(conversationProbePassed(empty())).toBe(true);
    const bad = empty(); bad.client.name = "Mary"; expect(conversationProbePassed(bad)).toBe(false);
    const wrong = empty(); wrong.response!.text = "7乘8係54"; expect(conversationProbePassed(wrong)).toBe(false);
  });
});

it("reuses only the staff member’s most recent failed note after an explicit follow-up", async () => {
  const admin = {} as never;
  const note = "Ada，任職老師。琴日同佢見面整理收入同家用。佢鍾意行山，有傾保障同儲蓄，未定下一步，會之後再聯絡。";
  const previous = { key: "raw", name: "訊息-previous.txt", created_at: new Date(Date.now()-1000).toISOString() };
  const failed = { key: "failed", name: "AI對話-failed.json", created_at: new Date().toISOString() };
  mocks.list.mockResolvedValue([failed, previous]);
  mocks.read.mockImplementation(async (_admin, _scope, key) => ({
    body: Buffer.from(key === "failed" ? JSON.stringify({ user: note, failedNote: true }) : note),
  }));
  expect(await recoverCoachNote(admin, "staff-a", "呢一個係見客嘅資料")).toBe(note);
  expect(await recoverCoachNote(admin, "staff-a", "請查官方保費")).toBeNull();
  expect(mocks.read.mock.calls.every((call) => call[1] === "coach/staff-a")).toBe(true);
  mocks.list.mockResolvedValue([{ ...failed, key: "success" }, previous]);
  mocks.read.mockImplementation(async (_admin, _scope, key) => ({
    body: Buffer.from(key === "success" ? JSON.stringify({ user: note, assistant: "已記低。" }) : note),
  }));
  expect(await recoverCoachNote(admin, "staff-a", "呢份係見客資料")).toBeNull();
});
