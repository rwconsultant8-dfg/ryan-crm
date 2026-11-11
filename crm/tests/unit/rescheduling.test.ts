import {beforeEach,describe,expect,it,vi} from "vitest";
import {prepareTasks} from "@/lib/whatsapp/tasks";
import {applyDraft,describeDraft,type Draft} from "@/lib/whatsapp/apply";
import {loadSchedulingContext} from "@/lib/whatsapp/scheduling-context";
import {encryptColumn,decryptColumn} from "@/lib/secure";
import {coachingDatabase} from "./helpers/coaching-db";
const owner="staff-a",id="00000000-0000-4000-8000-000000000001";
const change={operation:"reschedule" as const,task_id:id,day:"2026-11-09",new_day:"2026-11-10",time:"15:30",category:"appointment" as const,stage:"needs" as const,name:"Mary",plan:"傾教育基金",status:"planned" as const,result:""};
function row(taskId=id,staff=owner){return {id:taskId,owner_id:staff,day:change.day,category:change.category,stage:change.stage,status:"planned",updated_at:"v1",info:encryptColumn(taskId,"info",{},{name:"Mary",plan:"傾教育基金",time:"12:00",client_id:"customer-a",result:"已約好"})};}
function draft(taskItems:Awaited<ReturnType<typeof prepareTasks>>):Draft{return {channel:"telegram",texts:["Mary 改聽日三點半"],today:"2026-11-08",target:{mode:"none"},taskItems,extraction:{client:{name:"",age:"",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:"2026-11-08",summary:"改期",tasks:[change]}};}
beforeEach(()=>{process.env.DATA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");});
describe("appointment rescheduling",()=>{
 it("prepares cancellation and replacement without writing and preserves the client and plan",async()=>{
  const db=coachingDatabase({daily_tasks:[row()]});const items=await prepareTasks(db.db,owner,[change]);
  expect(items).toHaveLength(2);expect(items[0]).toMatchObject({id,operation:"update",status:"cancelled",updated_at:"v1"});
  expect(items[1]).toMatchObject({operation:"create",day:"2026-11-10",status:"planned"});
  expect(decryptColumn(items[1].id,"info",items[1].info)).toMatchObject({name:"Mary",plan:"傾教育基金",client_id:"customer-a",time:"15:30"});
  expect(decryptColumn(items[1].id,"info",items[1].info).result || "").toBe("");
  expect(db.tables.daily_tasks).toHaveLength(1);expect(db.tables.daily_tasks[0].status).toBe("planned");expect(db.rpc).not.toHaveBeenCalled();
  expect(describeDraft(draft(items))).toContain("原定：2026-11-09 12:00");expect(describeDraft(draft(items))).toContain("改為：2026-11-10 15:30");
 });
 it("submits both changes in one receipt-protected transaction only on confirmation",async()=>{
  const db=coachingDatabase({daily_tasks:[row()]});const items=await prepareTasks(db.db,owner,[change]);await applyDraft(db.db,owner,draft(items),"draft-id");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("wa_save_tasks",{p_actor:owner,p_draft:"draft-id",p_items:items});
 });
 it("supports time-only changes and keeps the existing time on date-only changes",async()=>{
  const db=coachingDatabase({daily_tasks:[row()]});
  const timeOnly=await prepareTasks(db.db,owner,[{...change,new_day:""}]);expect(timeOnly[1].day).toBe(change.day);
  const dayOnly=await prepareTasks(db.db,owner,[{...change,time:""}]);expect(decryptColumn(dayOnly[1].id,"info",dayOnly[1].info).time).toBe("12:00");
 });
 it("rejects missing changes, finished tasks, invalid times and cross-owner IDs",async()=>{
  const db=coachingDatabase({daily_tasks:[row()]});
  await expect(prepareTasks(db.db,owner,[{...change,new_day:"",time:""}])).rejects.toThrow("新日期或新時間");
  await expect(prepareTasks(db.db,owner,[{...change,time:"25:90"}])).rejects.toThrow();
  await expect(prepareTasks(db.db,"staff-b",[change])).rejects.toThrow("唯一配對");
  db.tables.daily_tasks[0].status="done";await expect(prepareTasks(db.db,owner,[change])).rejects.toThrow("已完成或已取消");
 });
 it("requires a unique appointment and rejects repeated updates and changed client links",async()=>{
  const db=coachingDatabase({daily_tasks:[row(),row("00000000-0000-4000-8000-000000000002")]});
  await expect(prepareTasks(db.db,owner,[{...change,task_id:""}])).rejects.toThrow("唯一配對");
  await expect(prepareTasks(db.db,owner,[change,change])).rejects.toThrow("多項更新");
  await expect(prepareTasks(db.db,owner,[{...change,client_id:"00000000-0000-4000-8000-000000000003"}])).rejects.toThrow("客戶連結");
 });
 it("loads saved scheduling context only for the sender, including legacy calendar entries",async()=>{
  const db=coachingDatabase({daily_tasks:[row(),row("other","staff-b"),{...row("done"),status:"done"}],activity_days:[{owner_id:owner,day:change.day,appts:encryptColumn(`${owner}:${change.day}`,"appts",{},{lunch:"Mary 中環"})}]});
  const context=await loadSchedulingContext(db.db,owner,"2026-11-08");expect(context.tasks).toHaveLength(1);expect(context.tasks[0]).toMatchObject({id,name:"Mary",time:"12:00"});expect(context.tasks[0]).not.toHaveProperty("client_id");
  expect(context.calendar).toEqual([expect.objectContaining({day:change.day,slot:"lunch",text:"Mary 中環"})]);
 });
});
