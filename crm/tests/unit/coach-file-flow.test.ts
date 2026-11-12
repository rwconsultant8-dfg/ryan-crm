import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
const mocks=vi.hoisted(()=>({admin:vi.fn(),send:vi.fn(),extract:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}));
vi.mock("@/lib/telegram/registry",()=>({resolveTelegramAgent:async()=>({id:"staff-a"}),validTelegramId:()=>true}));
vi.mock("@/lib/telegram/transport",()=>({sendTelegramText:mocks.send,downloadTelegramFile:vi.fn()}));
vi.mock("@/lib/whatsapp/ai",()=>({AiRefusal:class extends Error{},extractFromMessage:mocks.extract}));
import {handleTelegramIncoming} from "@/lib/telegram/handle";
import {readBotFile} from "@/lib/telegram/files";
import {decryptColumn} from "@/lib/secure";
import {hkToday} from "@/lib/weeks";
function database(){
 const clients:Record<string,any>[]=[];const files=new Map<string,string>();const drafts:Record<string,any>[]=[];const seen=new Set<string>();
 const rpc=vi.fn(async(_name:string,args:any)=>{
  let row=clients.find(c=>c.id===args.p_id && c.owner_id===args.p_actor);
  if(args.p_create){row={id:args.p_id,owner_id:args.p_actor,info:{}};clients.push(row);}
  if(row)Object.assign(row,args.p_patch);return{error:null};
 });
 const admin={rpc,storage:{getBucket:async()=>({data:{public:false},error:null}),from:()=>({upload:async(path:string,body:string)=>{if(!/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/.test(path))return{error:{code:"InvalidKey",statusCode:"400"}};files.set(path,body);return{error:null};},download:async(path:string)=>({data:new Blob([files.get(path)!]),error:null})})},from(table:string){
  if(table==="wa_seen_messages")return{insert:async({message_id}:{message_id:string})=>{if(seen.has(message_id))return{error:{code:"23505"}};seen.add(message_id);return{error:null};}};
  let patch:Record<string,unknown>|undefined;const filters:[string,unknown][]=[];
  const matches=()=>(table==="clients"?clients:drafts).filter(d=>filters.every(([key,value])=>d[key]===value));
  const q:any={select(){return q;},eq(k:string,v:unknown){filters.push([k,v]);return q;},order(){return q;},gte(){return q;},lte(){return q;},range(){return q;},limit(){return q;},maybeSingle:async()=>({data:matches()[0]||null,error:null}),single:async()=>({data:matches()[0]||null,error:null}),insert:async(row:Record<string,unknown>)=>{drafts.push({...row,status:"pending",created_at:new Date().toISOString()});return{error:null};},update(p:Record<string,unknown>){patch=p;return q;},then(ok:any,fail:any){let data:any[]=[];if(table==="wa_drafts" || table==="clients"){data=matches();if(patch)for(const row of data)Object.assign(row,patch);}return Promise.resolve({data,error:null}).then(ok,fail);}};return q;
 }};return{admin:admin as unknown as SupabaseClient,files,drafts,rpc};
}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));mocks.send.mockResolvedValue(undefined);mocks.extract.mockResolvedValue({client:{name:"試用客戶",age:"50",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:hkToday(),summary:"整理新客資料",tasks:[]});});
afterEach(()=>vi.unstubAllEnvs());
describe("coach text → private File → preview → confirmed CRM update",()=>{
 it("persists Chinese text before preview, writes the mapped owner's client only on confirmation, and does not duplicate writes",async()=>{
  const db=database();mocks.admin.mockReturnValue(db.admin);
  const text="有位試用客戶，50歲，有小朋友。";
  await handleTelegramIncoming({from:"12345",messageId:"telegram:1",type:"text",text});
  expect(db.files.size).toBe(2);const path=[...db.files.keys()][0];expect(path).toMatch(/^coach\/staff-a\//);
  expect((await readBotFile(db.admin,"coach/staff-a",path.slice("coach/staff-a/".length))).body.toString()).toBe(text);
  expect(db.drafts[0].owner_id).toBe("staff-a");expect(db.rpc).toHaveBeenCalledTimes(2);
  const automatic=db.rpc.mock.calls[0][1];expect(automatic.p_create).toBe(true);expect(decryptColumn(automatic.p_id,"info",automatic.p_patch.info)).toEqual({name:"試用客戶"});
  const [name,args]=db.rpc.mock.calls[1] as unknown as [string,any];expect(name).toBe("wa_save_client");expect(args.p_actor).toBe("staff-a");expect(args.p_create).toBe(false);expect(decryptColumn(args.p_id,"info",args.p_patch.info)).toMatchObject({name:"試用客戶",age:"50"});
  expect(mocks.send).toHaveBeenLastCalledWith("12345",expect.stringContaining("已幫你記低"));
  await handleTelegramIncoming({from:"12345",messageId:"telegram:2",type:"text",text:"確認"});expect(db.rpc).toHaveBeenCalledTimes(2);expect(db.files.size).toBe(2);
 });
});
