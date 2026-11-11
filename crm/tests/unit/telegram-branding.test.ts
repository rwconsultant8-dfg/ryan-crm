import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {coachingDatabase} from "./helpers/coaching-db";
const token=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/telegram/credentials",()=>({resolveCoachToken:token}));
import {syncTelegramDisplayName,TEAM_BOT_NAME} from "@/lib/telegram/branding";
let db:ReturnType<typeof coachingDatabase>,calls:{method:string;body:any}[];
beforeEach(()=>{vi.stubEnv("VERCEL_ENV","production");token.mockResolvedValue("12345:fake-token-never-log");db=coachingDatabase();calls=[];vi.spyOn(console,"info").mockImplementation(()=>{});vi.stubGlobal("fetch",vi.fn(async(url:string,options:any)=>{const method=url.split("/").at(-1)!;calls.push({method,body:JSON.parse(options.body)});return{ok:true,json:async()=>({ok:true,result:method==="getMe"?{username:"Ryan_main_bot",is_bot:true}:method==="getMyName"?{name:TEAM_BOT_NAME}:true})};}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("requested Telegram display name",()=>{
 it("verifies identity and readback before recording success, and skips subsequent polls",async()=>{await syncTelegramDisplayName(db.db);await syncTelegramDisplayName(db.db);expect(calls.map(c=>c.method)).toEqual(["getMe","setMyName","getMyName"]);expect(calls[1].body).toEqual({name:"Ryan大佬bot"});expect(db.tables.wa_seen_messages).toHaveLength(1);});
 it("cannot rename the private PA or another bot",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({ok:true,result:{username:"Ryan_PA_bot",is_bot:true}})})));await expect(syncTelegramDisplayName(db.db)).rejects.toThrow("identity");expect(fetch).toHaveBeenCalledTimes(1);expect(db.tables.wa_seen_messages).toHaveLength(0);});
 it("does not change Telegram from preview builds",async()=>{vi.stubEnv("VERCEL_ENV","preview");await syncTelegramDisplayName(db.db);expect(fetch).not.toHaveBeenCalled();});
 it("does not record failed or unverified renames as success",async()=>{vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>({ok:true,result:url.endsWith("getMe")?{username:"Ryan_main_bot",is_bot:true}:url.endsWith("getMyName")?{name:"舊名"}:true})})));await expect(syncTelegramDisplayName(db.db)).rejects.toThrow("not verified");expect(db.tables.wa_seen_messages).toHaveLength(0);});
});
