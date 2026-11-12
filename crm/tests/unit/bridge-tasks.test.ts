import {beforeEach,describe,expect,it,vi} from "vitest";
import {handleTaskCommand} from "@/lib/bridge/tasks";
import {commandSchema} from "@/lib/bridge/schema";
import {hkToday} from "@/lib/weeks";
import {sealDraft,openDraft} from "@/lib/whatsapp/drafts";
import {encryptColumn} from "@/lib/secure";
import type {SupabaseClient} from "@supabase/supabase-js";
const id="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",draftId="33333333-3333-4333-8333-333333333333";
const actor={id,phone:"10000000001",role:"agent" as const,messageId:"test"};
const task=()=>({operation:"create" as const,day:hkToday(),category:"planning" as const,stage:"" as const,name:"Test",plan:"Original",status:"planned" as const,result:""});
function dbMock(){
 const rows:Record<string,any[]>={daily_tasks:[],wa_drafts:[],wa_task_receipts:[]};
 const rpc=vi.fn(async()=>({error:null}));
 const from=(table:string)=>{let op="select",value:any,one=false,start=0,end=Infinity;
 const filters:Record<string,any>={};
 const bounds:((row:Record<string,any>)=>boolean)[]=[];
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filters[k]=v;return q;},gte:(key:string,min:string)=>{bounds.push(row=>row[key]>=min);return q;},
 lte:(key:string,max:string)=>{bounds.push(row=>row[key]<=max);return q;},
 order:()=>q,range:(from:number,to:number)=>{start=from;end=to+1;return q;},maybeSingle:()=>{one=true;return q;},insert:(v:any)=>{op="insert";value=v;return q;},update:(v:any)=>{op="update";value=v;return q;},then:(resolve:any)=>{
 let found=rows[table].filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)&&bounds.every(test=>test(r))).slice(start,end);
 if(op==="insert"){rows[table].push(value);found=[value];}if(op==="update")found.forEach(r=>Object.assign(r,value));
 return Promise.resolve(resolve({data:one?found[0]??null:found,error:null}));}};return q;};
 return {rows,rpc,db:{from,rpc} as unknown as SupabaseClient};
}
beforeEach(()=>{process.env.DATA_ENCRYPTION_KEY=Buffer.alloc(32,9).toString("base64");});
describe("WhatsApp daily plans",()=>{
 it("checks the receipt instead of claiming an applied draft was saved",async()=>{const m=dbMock();const p:any=await handleTaskCommand(m.db,actor,{action:"tasks_prepare",tasks:[task()]});m.rows.wa_drafts[0].status="applied";expect(await handleTaskCommand(m.db,actor,{action:"tasks_status",draft_id:p.draft_id})).toMatchObject({saved:false,status:"unconfirmed"});m.rows.wa_task_receipts.push({draft_id:p.draft_id,owner_id:id});expect(await handleTaskCommand(m.db,actor,{action:"tasks_status",draft_id:p.draft_id})).toMatchObject({saved:true,status:"saved"});});
 it("cannot inspect another owner's draft status",async()=>{const m=dbMock();m.rows.wa_drafts=[{id:draftId,owner_id:other,status:"pending"}];await expect(handleTaskCommand(m.db,actor,{action:"tasks_status",draft_id:draftId})).rejects.toMatchObject({status:404});});
 it("rejects owner overrides in writes",()=>expect(commandSchema.safeParse({action:"tasks_prepare",owner_id:other,tasks:[task()]}).success).toBe(false));
 it("cannot list another owner's tasks",async()=>{const m=dbMock();await expect(handleTaskCommand(m.db,actor,{action:"tasks_list",from:hkToday(),to:hkToday(),owner_id:other})).rejects.toMatchObject({status:403});});
 it("filters staff lists and lets manager review team",async()=>{const m=dbMock();m.rows.daily_tasks=[{id,owner_id:id,day:hkToday(),info:{}},{id:other,owner_id:other,day:hkToday(),info:{}}];expect((await handleTaskCommand(m.db,actor,{action:"tasks_list",from:hkToday(),to:hkToday()}) as any).tasks).toHaveLength(1);expect((await handleTaskCommand(m.db,{...actor,role:"admin"},{action:"tasks_list",from:hkToday(),to:hkToday()}) as any).tasks).toHaveLength(2);});
 it("previews without writing tasks; confirm retries use the same receipt key",async()=>{const m=dbMock();const p:any=await handleTaskCommand(m.db,actor,{action:"tasks_prepare",tasks:[task()]});expect(p.saved).toBe(false);expect(m.rows.daily_tasks).toHaveLength(0);expect(m.rows.wa_drafts[0].payload).not.toContain("Original");for(let i=0;i<2;i++)await handleTaskCommand(m.db,actor,{action:"tasks_confirm",draft_id:p.draft_id});expect(m.rpc).toHaveBeenCalledTimes(2);expect(m.rpc.mock.calls[0]).toEqual(m.rpc.mock.calls[1]);});
 it("denies cross-owner confirmation before any RPC",async()=>{const m=dbMock();m.rows.wa_drafts=[{id:draftId,owner_id:other,status:"pending"}];await expect(handleTaskCommand(m.db,actor,{action:"tasks_confirm",draft_id:draftId})).rejects.toMatchObject({status:404});expect(m.rpc).not.toHaveBeenCalled();});
 it("preserves original plan in update preview",async()=>{const m=dbMock();m.rows.daily_tasks=[{id,owner_id:id,day:hkToday(),category:"planning",stage:"",updated_at:"2026-10-23T00:00:00Z",info:encryptColumn(id,"info",{},{name:"Test",plan:"Original",result:""})}];const p:any=await handleTaskCommand(m.db,actor,{action:"tasks_prepare",tasks:[{...task(),operation:"update",plan:"Overwrite",status:"done",result:"Finished"}]});expect(p.preview).toContain("Original");expect(p.preview).not.toContain("Overwrite");expect(p.preview).toContain("Finished");});
 it("cancels a pending draft and blocks later confirmation",async()=>{const m=dbMock();const p:any=await handleTaskCommand(m.db,actor,{action:"tasks_prepare",tasks:[task()]});await handleTaskCommand(m.db,actor,{action:"tasks_cancel",draft_id:p.draft_id});await expect(handleTaskCommand(m.db,actor,{action:"tasks_confirm",draft_id:p.draft_id})).rejects.toMatchObject({status:409});expect(m.rpc).not.toHaveBeenCalled();});
 it("does not report success when saving fails",async()=>{const m=dbMock();const p:any=await handleTaskCommand(m.db,actor,{action:"tasks_prepare",tasks:[task()]});m.rpc.mockResolvedValueOnce({error:{message:"failed"}} as any);await expect(handleTaskCommand(m.db,actor,{action:"tasks_confirm",draft_id:p.draft_id})).rejects.toMatchObject({status:503});});
});
