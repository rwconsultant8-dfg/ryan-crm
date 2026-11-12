import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), setStatus: vi.fn(), apply: vi.fn(), extract: vi.fn(), seal: vi.fn() }));
vi.mock("@/lib/whatsapp/scheduling-context",()=>({loadSchedulingContext:async()=>({tasks:[],calendar:[]})}));
vi.mock("@/lib/whatsapp/ai", () => ({ AiRefusal: class extends Error {}, extractFromMessage: mocks.extract }));
vi.mock("@/lib/whatsapp/drafts", () => ({ latestPending: mocks.latest, setStatus: mocks.setStatus, reopen: vi.fn(), sealDraft: mocks.seal }));
vi.mock("@/lib/whatsapp/apply", () => ({ applyDraft: mocks.apply, describeDraft: () => "預覽，回覆確認", describeSavedDraft:()=>"已整理並同步到 app", hasContent: () => true, loadClientNames: async () => [], matchClient: vi.fn() }));
import {openJob} from "@/lib/codex/jobs";
import { processIncoming } from "@/lib/whatsapp/handle";
const draft = { channel: "telegram", target: { mode: "none" }, extraction: { tasks: [] } };
const admin = { from: vi.fn() };
const send = vi.fn().mockResolvedValue(undefined);
const message = (text: string) => ({ from: "123456789", messageId: "telegram:42", type: "text", text });
beforeEach(() => { vi.clearAllMocks(); mocks.latest.mockResolvedValue(null); mocks.setStatus.mockResolvedValue(true); mocks.apply.mockResolvedValue(undefined); });
afterEach(()=>vi.unstubAllEnvs());
describe("Telegram explicit confirmation", () => {
  it("saves an encrypted owner-scoped receipt and automatically applies clear Telegram updates", async () => {
    mocks.extract.mockResolvedValue({ tasks: [], client: { name: "" }, date: "2026-11-06" });
    mocks.seal.mockReturnValue("encrypted-draft");
    const insert = vi.fn().mockResolvedValue({ error: null }); admin.from.mockReturnValue({ insert });
    await processIncoming(message("今日同客食早餐"), "staff-a", admin as never, send, "telegram");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "staff-a", payload: "encrypted-draft" }));
    expect(mocks.seal).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ channel: "telegram" }));
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("123456789", "已幫你記低，可以喺 app 睇返。");
  });
  it("queues Codex work without invoking paid extraction or applying a customer record",async()=>{
    vi.stubEnv("AI_MODE","codex");vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));
    const insert=vi.fn().mockResolvedValue({error:null});admin.from.mockReturnValue({insert});
    await processIncoming(message("今日同客食早餐"),"staff-a",admin as never,send,"telegram");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({owner_id:"staff-a",status:"cancelled",payload:expect.stringMatching(/^codex-job-v1\.pending\./)}));
    expect(mocks.extract).not.toHaveBeenCalled();expect(mocks.apply).not.toHaveBeenCalled();expect(mocks.seal).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("gives a rough time range for document work while keeping simple acknowledgements short",async()=>{
    vi.stubEnv("AI_MODE","codex");vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));
    admin.from.mockReturnValue({insert:vi.fn().mockResolvedValue({error:null})});
    await processIncoming(message("幫我修改PowerPoint，翻譯成中文"),"staff-a",admin as never,send,"telegram");
    expect(send).toHaveBeenCalledWith("123456789",expect.stringContaining("預計約 3–8 分鐘"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("requests missing rescheduling details and retains the question as context without applying records", async()=>{
    mocks.extract.mockResolvedValue({clarification:"Mary 原本有兩項安排，請講返原定日期同時間。"});
    admin.from.mockReturnValue({insert:vi.fn().mockResolvedValue({error:null})});
    await processIncoming(message("Mary 改到聽日下午三點"),"staff-a",admin as never,send,"telegram");
    expect(send).toHaveBeenCalledWith("123456789",expect.stringContaining("原本有兩項安排"));
    expect(mocks.seal).toHaveBeenCalled();expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("confirmation applies only the mapped employee's draft", async () => {
    mocks.latest.mockResolvedValue({ id: "draft-a", draft });
    await processIncoming(message("確認"), "staff-a", admin as never, send, "telegram");
    expect(mocks.latest).toHaveBeenCalledWith(admin, "staff-a");
    expect(mocks.apply).toHaveBeenCalledWith(admin, "staff-a", draft, "draft-a");
  });
  it("a repeated confirmation cannot apply an already-claimed draft", async () => {
    mocks.latest.mockResolvedValue({ id: "draft-a", draft }); mocks.setStatus.mockResolvedValue(false);
    await processIncoming(message("確認"), "staff-a", admin as never, send, "telegram");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("cancellation never applies records", async () => {
    mocks.latest.mockResolvedValue({ id: "draft-a", draft });
    await processIncoming(message("取消"), "staff-a", admin as never, send, "telegram");
    expect(mocks.setStatus).toHaveBeenCalledWith(admin, "draft-a", "cancelled");
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("isolates a new meeting note while keeping an explicit clarification reply", async () => {
    vi.stubEnv("AI_MODE","codex");
    vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));
    const insert=vi.fn().mockResolvedValue({error:null});admin.from.mockReturnValue({insert});
    const prior="Mary 要改期", question="Mary 原定邊日幾點？";
    mocks.latest.mockResolvedValue({id:"pending",created_at:new Date().toISOString(),draft:{...draft,texts:[prior],extraction:{clarification:question}}});
    await processIncoming(message("今日同 Ada 見面了解佢嘅職業同家用"),"staff-a",admin as never,send,"telegram");
    let stored=insert.mock.calls[0][0];
    expect(openJob(stored.id,stored.payload)).toMatchObject({draftContext:[],texts:"今日同 Ada 見面了解佢嘅職業同家用"});
    await processIncoming({...message("原本係聽日下午三點"),messageId:"telegram:43",quotedText:question},"staff-a",admin as never,send,"telegram");
    stored=insert.mock.calls[1][0];
    expect(openJob(stored.id,stored.payload)).toMatchObject({draftContext:[prior],quotedText:question});
  });
  it("cannot apply a current draft by confirming a different quoted message", async () => {
    mocks.latest.mockResolvedValue({id:"current",draft});
    await processIncoming({...message("確認"),quotedText:"另一份見客紀錄"},"staff-a",admin as never,send,"telegram");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });
  it("cannot confirm a legacy WhatsApp draft through Telegram", async () => {
    mocks.latest.mockResolvedValue({ id: "legacy", draft: { ...draft, channel: undefined } });
    await processIncoming(message("確認"), "staff-a", admin as never, send, "telegram");
    expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.setStatus).not.toHaveBeenCalled();
  });
  it("explains an account verification block without telling the user to retry or applying customer data", async () => {
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      mocks.extract.mockRejectedValueOnce({status:403,error:{error:{type:"customer_verification_required",message:"sensitive-error-placeholder"}}});
      await processIncoming(message("客戶更新測試"),"staff-a",admin as never,send,"telegram");
      expect(send).toHaveBeenCalledWith("123456789",expect.stringContaining("請搵 Ryan"));
      expect(send.mock.calls[0][1]).not.toMatch(/Codex|API|File|驗證|佇列|資料庫/);
      expect(send.mock.calls[0][1]).not.toContain("稍後再試");
      expect(send.mock.calls[0][1]).not.toContain("sensitive-error-placeholder");
      expect(mocks.apply).not.toHaveBeenCalled();expect(mocks.seal).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("AI extraction failed",{status:403,type:"customer_verification_required"});
    } finally {log.mockRestore();}
  });

});
