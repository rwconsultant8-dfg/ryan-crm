import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
import {aiClient,hasAIRequestAuth,withAIIdentity} from "@/lib/ai-client";
beforeEach(()=>{for(const name of ["ANTHROPIC_API_KEY","AI_GATEWAY_API_KEY","VERCEL_OIDC_TOKEN"])vi.stubEnv(name,"");});
afterEach(()=>vi.unstubAllEnvs());
describe("AI request-scoped platform identity",()=>{
 it("uses the identity captured from a function request and does not retain it outside that request",async()=>{await expect(hasAIRequestAuth()).resolves.toBe(false);await withAIIdentity("request-token",async()=>{expect(await hasAIRequestAuth()).toBe(true);expect((await aiClient()).baseURL).toBe("https://ai-gateway.vercel.sh");});expect(await hasAIRequestAuth()).toBe(false);});
 it("keeps concurrent background request identities isolated",async()=>{const result=await Promise.all([withAIIdentity("one",async()=>{await Promise.resolve();return(await aiClient()).authToken;}),withAIIdentity("two",async()=>{await Promise.resolve();return(await aiClient()).authToken;})]);expect(result).toEqual(["one","two"]);});
});
