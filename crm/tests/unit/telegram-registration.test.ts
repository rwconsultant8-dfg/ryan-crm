import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),resolve:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireAdmin:mocks.auth}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/telegram/registry",async()=>({...await vi.importActual<Record<string,unknown>>("@/lib/telegram/registry"),resolveTelegramAgent:mocks.resolve}));
import { registerBotsAction } from "@/app/(app)/admin/bots/actions";
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({});mocks.resolve.mockResolvedValue({id:"ryan"});for(const[key,value]of Object.entries({TELEGRAM_COACH_BOT_TOKEN:"coach",TELEGRAM_COACH_WEBHOOK_SECRET:"coach-secret",TELEGRAM_PA_BOT_TOKEN:"pa",TELEGRAM_PA_WEBHOOK_SECRET:"pa-secret",TELEGRAM_PA_USER_ID:"12345",ANTHROPIC_API_KEY:"unit-test"}))vi.stubEnv(key,value);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("admin-only bot registration",()=>{
 it("does not contact Telegram when caller is not an admin",async()=>{mocks.auth.mockRejectedValue(new Error("not admin"));const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(registerBotsAction()).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();});
 it("does not register bots until Ryan is mapped to an active CRM account",async()=>{mocks.resolve.mockResolvedValue(null);const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);expect((await registerBotsAction()).ok).toBe(false);expect(fetcher).not.toHaveBeenCalled();});
 it("detects two tokens resolving to the same actual bot",async()=>{const fetcher=vi.fn(async()=>({ok:true,json:async()=>({ok:true,result:{id:1,username:"one_bot"}})}));vi.stubGlobal("fetch",fetcher);expect((await registerBotsAction()).ok).toBe(false);expect(fetcher.mock.calls).toHaveLength(2);});
 it("connects different bots to different routes and verifies both without dropping queued updates",async()=>{
  const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>({ok:true,result:url.endsWith("/getMe")?{id:url.includes("botcoach/")?1:2,username:url.includes("botcoach/")?"coach_bot":"pa_bot"}:url.endsWith("/getWebhookInfo")?{url:`https://ryan-crm-chi.vercel.app/api/telegram${url.includes("botpa/")?"/pa":""}`}:{}})}));vi.stubGlobal("fetch",fetcher);
  expect((await registerBotsAction()).ok).toBe(true);
  const writes=fetcher.mock.calls.filter(c=>c[0].endsWith("/setWebhook"));expect(writes).toHaveLength(2);
  const bodies=writes.map(call=>JSON.parse((call as unknown as [string,RequestInit])[1].body as string));
  expect(bodies.map(b=>b.url)).toEqual(["https://ryan-crm-chi.vercel.app/api/telegram","https://ryan-crm-chi.vercel.app/api/telegram/pa"]);
  expect(bodies.map(b=>b.secret_token)).toEqual(["coach-secret","pa-secret"]);expect(bodies.every(b=>b.drop_pending_updates===false)).toBe(true);
 });
});
