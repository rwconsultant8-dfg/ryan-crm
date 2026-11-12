import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),ready:vi.fn(),token:vi.fn(),save:vi.fn(),ai:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireAdmin:mocks.auth}));
vi.mock("@/lib/telegram/credentials",()=>({isCoachReady:mocks.ready,resolveCoachToken:mocks.token,storeCoachToken:mocks.save}));
vi.mock("@/lib/ai-client",()=>({aiClient:()=>({messages:{create:mocks.ai}}),aiModel:()=>"unit-test-model",hasAIAuth:()=>true}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {saveCoachCredentialAction,registerCoachAction,checkAIServiceAction} from "@/app/(app)/admin/bots/actions";
const fakeToken="12345:abcdefghijklmnopqrstuvwxyz";
const form=()=>{const f=new FormData();f.set("token",fakeToken);return f;};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("TELEGRAM_COACH_BOT_USERNAME","Ryan_main_bot");vi.stubEnv("TELEGRAM_COACH_WEBHOOK_SECRET","coach-secret");mocks.auth.mockResolvedValue({});mocks.ready.mockResolvedValue(true);mocks.token.mockResolvedValue(fakeToken);mocks.save.mockResolvedValue(undefined);mocks.ai.mockResolvedValue({content:[{type:"text",text:"OK"}]});});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("單獨安全啟用ZEST 團隊助手",()=>{
 it("refuses a non-admin before reading or storing a token",async()=>{mocks.auth.mockRejectedValue(new Error("not admin"));await expect(saveCoachCredentialAction(form())).rejects.toThrow();expect(mocks.save).not.toHaveBeenCalled();});
 it("does not persist a token for the wrong actual bot",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({ok:true,result:{username:"wrong_bot"}})})));const result=await saveCoachCredentialAction(form());expect(result.ok).toBe(false);expect(mocks.save).not.toHaveBeenCalled();expect(result.message).not.toContain(fakeToken);});
 it("stores verified credentials, connects only the coach route and checks AI without requiring a PA token",async()=>{
 const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>({ok:true,result:url.endsWith("/getMe")?{id:42,username:"Ryan_main_bot"}:url.endsWith("/getWebhookInfo")?{url:"https://ryan-crm-chi.vercel.app/api/telegram"}:{}})}));vi.stubGlobal("fetch",fetcher);
 expect((await saveCoachCredentialAction(form())).ok).toBe(true);expect(mocks.save).toHaveBeenCalledWith(fakeToken);expect(fetcher.mock.calls.every(c=>c[0].includes(`/bot${fakeToken}/`))).toBe(true);expect(fetcher.mock.calls.filter(c=>c[0].endsWith("/setWebhook"))).toHaveLength(1);expect(mocks.ai).toHaveBeenCalledOnce();
 });
 it("reports partial activation accurately when AI is not yet usable",async()=>{vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>({ok:true,result:url.endsWith("/getMe")?{username:"Ryan_main_bot"}:url.endsWith("/getWebhookInfo")?{url:"https://ryan-crm-chi.vercel.app/api/telegram"}:{}})})));mocks.ai.mockRejectedValue(new Error("credits required"));const result=await registerCoachAction();expect(result.ok).toBe(false);expect(result.message).toContain("Telegram 連線已接通");expect(result.message).toContain("AI 整理暫時未能使用");expect(result.message).not.toContain(fakeToken);});
 it("lets the supervisor check AI and identify the required account action without changing Telegram settings",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  mocks.ai.mockRejectedValueOnce({status:403,error:{error:{type:"customer_verification_required"}}});
  const result=await checkAIServiceAction();
  expect(result.ok).toBe(false);expect(result.needsVerification).toBe(true);expect(result.message).toContain("付款卡驗證");
  expect(mocks.auth).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
 });

});
