import {beforeEach,describe,it,expect,vi} from "vitest";
import {coachingDatabase} from "./helpers/coaching-db";
import {sealCoaching,openCoaching} from "@/lib/coaching/store";
import {createCoachingAction,respondCoachingAction} from "@/app/(app)/clients/coaching-actions";
import {saveMeetingAction} from "@/app/(app)/clients/meeting-actions";
import {encryptColumn,decryptColumn} from "@/lib/secure";
const context=vi.hoisted(()=>({db:null as any,profile:null as any}));
vi.mock("@/lib/auth",()=>({requireUser:async()=>({supabase:context.db,profile:context.profile}),requireAdmin:async()=>{if(context.profile.role!=="admin")throw Error("Forbidden");return{supabase:context.db,profile:context.profile};},displayName:(p:any)=>p.full_name}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>context.db}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
const owner="11111111-1111-4111-8111-111111111111",admin="22222222-2222-4222-8222-222222222222",client="33333333-3333-4333-8333-333333333333",id="44444444-4444-4444-8444-444444444444";
let fake:ReturnType<typeof coachingDatabase>;
beforeEach(()=>{process.env.DATA_ENCRYPTION_KEY=Buffer.alloc(32,12).toString("base64");vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));fake=coachingDatabase({clients:[{id:client,owner_id:owner,updated_at:"2026-11-06T00:00:00.000Z",info:encryptColumn(client,"info",{},{name:"Jacqueline"})}],profiles:[{id:owner,active:true}]});context.db=fake.db;context.profile={id:admin,role:"admin",full_name:"Ryan"};});
const create=()=>createCoachingAction({id,clientId:client,request:"請核對客戶交代嘅舊保單",dueDay:"2026-11-07"});
describe("coaching ownership and acknowledgement",()=>{
 it("creates an encrypted owner-scoped instruction once without editing client facts",async()=>{expect((await create()).ok).toBe(true);expect((await create()).ok).toBe(true);expect(fake.tables.wa_drafts).toHaveLength(1);expect(fake.tables.wa_drafts[0].owner_id).toBe(owner);expect(fake.tables.wa_drafts[0].payload).not.toContain("保單");expect(fake.writes.filter(w=>w.table==="clients")).toHaveLength(0);});
 it("refuses staff creation, cross-owner replies, staff closing and stale revisions",async()=>{await create();context.profile={id:owner,role:"staff",full_name:"Jean"};await expect(create()).rejects.toThrow("Forbidden");expect((await respondCoachingAction({id,revision:null,reply:"",close:true})).ok).toBe(false);context.profile.id=admin;expect((await respondCoachingAction({id,revision:null,reply:"冒認回覆",close:false})).ok).toBe(false);context.profile.id=owner;expect((await respondCoachingAction({id,revision:null,reply:"已收齊，等主管核對",close:false})).ok).toBe(true);expect((await respondCoachingAction({id,revision:null,reply:"覆寫",close:false})).ok).toBe(false);const row=fake.tables.wa_drafts[0];context.profile={id:admin,role:"admin"};expect((await respondCoachingAction({id,revision:row.decided_at,reply:"",close:true})).ok).toBe(true);expect(openCoaching(row as any).status).toBe("closed");});
 it("rejects ownership changes after an instruction",async()=>{await create();fake.tables.clients[0].owner_id=admin;expect((await respondCoachingAction({id,revision:null,reply:"",close:true})).ok).toBe(false);});
});
describe("manual meeting ownership and retry",()=>{
 const input=()=>({id,clientId:client,day:"2026-11-06",summary:"已傾現有安排",response:"想先核對",blocker:"未齊資料",needs_help:true,next_step:"收集資料",next_day:"2026-11-07"});
 it("rejects another person's customer even for supervisor",async()=>{expect((await saveMeetingAction(input())).ok).toBe(false);expect(fake.tables.wa_drafts).toHaveLength(0);});
 it("retries partial task failure without repeating meeting or task",async()=>{context.profile={id:owner,role:"staff"};fake.failTasksOnce();expect((await saveMeetingAction(input())).ok).toBe(false);expect((await saveMeetingAction(input())).ok).toBe(true);expect((await saveMeetingAction(input())).ok).toBe(true);expect(JSON.parse(decryptColumn(client,"info",fake.tables.clients[0].info).contact_history)).toHaveLength(1);expect(fake.tables.daily_tasks).toHaveLength(1);});
 it("does not record future plans as a past meeting",async()=>{context.profile={id:owner,role:"staff"};expect((await saveMeetingAction({...input(),day:"2026-11-07"})).ok).toBe(false);expect(fake.tables.wa_drafts).toHaveLength(0);});
});
