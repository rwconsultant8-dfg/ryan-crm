import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {coachingDatabase} from "./helpers/coaching-db";
const session=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireUser:session.auth}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:session.admin}));
import {getProfileAvatar,verifyProfileAvatarAccounts} from "@/lib/profile-avatar";
import {GET} from "@/app/api/account/avatar/route";
import {profileAvatarUrl} from "@/lib/avatar-url";
const ryan={id:"ryan",full_name:"Ryan",role:"admin" as const,active:true,email:"ryan@example.test"};
const chelsea={...ryan,id:"chelsea",full_name:"Chelsea",role:"agent" as const},kiky={...chelsea,id:"kiky",full_name:"Kiky"};
const momo={...ryan,id:"momo",full_name:"Momo",email:"momo@example.test"};
let fake:ReturnType<typeof coachingDatabase>;
beforeEach(()=>{fake=coachingDatabase({profiles:[ryan,chelsea,kiky,momo]});session.auth.mockResolvedValue({profile:ryan});session.admin.mockReturnValue(fake.db);session.admin.mockClear();vi.stubEnv("VERCEL_ENV","production");vi.stubEnv("ZEST_MOMO_AVATAR_EMAIL",momo.email);});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("private account portraits",()=>{
 it("uses the verified Momo email even if the old display name or supervisor role says Ryan",async()=>{
  const oldMomo={...momo,full_name:"Ryan"};fake.tables.profiles[3]=oldMomo;session.auth.mockResolvedValue({profile:oldMomo});
  const avatar=await getProfileAvatar(oldMomo);expect(avatar).toEqual({key:"momo",label:"Momo",accountId:"momo"});
  const response=await GET(new Request(`https://ryan-crm-chi.vercel.app${profileAvatarUrl(avatar!)}`));
  expect(response.status).toBe(200);expect((await response.arrayBuffer()).byteLength).toBe(30116);
  expect(response.headers.get("Vary")).toBe("Cookie");
 });
 it("changes image URLs when switching account or portrait and rejects stale or cross-account URLs",async()=>{
  const ryanUrl=profileAvatarUrl({key:"ryan",accountId:ryan.id});const momoUrl=profileAvatarUrl({key:"momo",accountId:momo.id});
  expect(ryanUrl).not.toBe(momoUrl);expect(momoUrl).toContain("account=momo");
  session.auth.mockResolvedValue({profile:momo});
  expect((await GET(new Request(`https://ryan-crm-chi.vercel.app${ryanUrl}`))).status).toBe(404);
  expect((await GET(new Request("https://ryan-crm-chi.vercel.app/api/account/avatar?account=momo&portrait=ryan"))).status).toBe(404);
  expect((await GET(new Request(`https://ryan-crm-chi.vercel.app${momoUrl}`))).status).toBe(200);
 });
 it("does not assign Momo's private portrait to an unrelated account merely named Momo",async()=>{
  expect(await getProfileAvatar({...momo,id:"unrelated",email:"someone-else@example.test"})).toBeNull();
 });
 it("serves the four correctly labelled original JPEGs for their own signed-in accounts",async()=>{for(const [profile,bytes] of [[ryan,11723],[chelsea,26535],[kiky,42520],[momo,30116]] as const){session.auth.mockResolvedValue({profile});const response=await GET(new Request("https://ryan-crm-chi.vercel.app/api/account/avatar"));expect(response.status).toBe(200);expect(response.headers.get("Content-Type")).toBe("image/jpeg");expect(response.headers.get("Cache-Control")).toBe("private, no-store");const image=new Uint8Array(await response.arrayBuffer());expect(image.length).toBe(bytes);expect([...image.slice(0,2)]).toEqual([255,216]);expect([...image.slice(-2)]).toEqual([255,217]);}});
 it("requires login before reading profiles or images",async()=>{session.auth.mockRejectedValue(Error("redirect:/login"));await expect(GET(new Request("https://ryan-crm-chi.vercel.app/api/account/avatar"))).rejects.toThrow("redirect:/login");expect(session.admin).not.toHaveBeenCalled();});
 it("does not give portraits to unrelated or inactive accounts",async()=>{for(const profile of [{...ryan,id:"jean",full_name:"Jean"},{...ryan,id:"staff",role:"agent"},{...ryan,active:false}]){session.auth.mockResolvedValue({profile});expect((await GET(new Request("https://ryan-crm-chi.vercel.app/api/account/avatar"))).status).toBe(404);}expect(session.admin).not.toHaveBeenCalled();});
 it("refuses ambiguous same-name accounts even for staff who only see their own profile through RLS",async()=>{fake.tables.profiles.push({...kiky,id:"second-kiky",full_name:"Kiki"});expect(await getProfileAvatar(kiky)).toBe(null);session.auth.mockResolvedValue({profile:kiky});expect((await GET(new Request("https://ryan-crm-chi.vercel.app/api/account/avatar"))).status).toBe(404);});
 it("a name match alone cannot give another profile id the image",async()=>{expect(await getProfileAvatar({...chelsea,id:"different"})).toBe(null);});
 it("accepts the supplied spelling aliases while keeping each person separate",async()=>{fake.tables.profiles[1].full_name="Chelsae";fake.tables.profiles[2].full_name="Kiki";expect((await getProfileAvatar({...chelsea,full_name:"Chelsae"}))?.key).toBe("chelsea");expect((await getProfileAvatar({...kiky,full_name:"Kiki"}))?.key).toBe("kiky");});
 it("the live checks record only deployment markers and leave profiles intact",async()=>{vi.spyOn(console,"info").mockImplementation(()=>{});await verifyProfileAvatarAccounts(fake.db);await verifyProfileAvatarAccounts(fake.db);expect(fake.tables.wa_seen_messages).toHaveLength(4);expect(fake.writes.every(w=>w.table==="wa_seen_messages")).toBe(true);});
});
