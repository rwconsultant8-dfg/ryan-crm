import {beforeEach,describe,it,expect,vi} from "vitest";
import {ensureNamedClients} from "@/lib/whatsapp/named-clients";
import {coachingDatabase} from "./helpers/coaching-db";
import {decryptColumn,encryptColumn} from "@/lib/secure";
vi.mock("@/lib/whatsapp/ai",()=>({AiRefusal:class extends Error{},extractFromMessage:vi.fn()}));
import {processIncoming} from "@/lib/whatsapp/handle";
import type {Extraction} from "@/lib/whatsapp/schema";
const empty:Extraction={client:{name:"",age:"",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:"2026-11-08",summary:"",tasks:[]};
beforeEach(()=>{process.env.DATA_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");});
describe("immediate customer profiles from names",()=>{
 it("automatically saves a Telegram afternoon appointment without asking for or inventing a time",async()=>{
  const db=coachingDatabase(),send=vi.fn();
  await processIncoming({from:"123",messageId:"period-only",type:"text",text:"Mary 聽日下午中環見"},"staff-a",db.db,send,"telegram",{today:empty.date,extract:async()=>({...empty,client_names:["Mary"],tasks:[{operation:"create",day:"2026-11-09",time:"",period:"afternoon",category:"appointment",stage:"",name:"Mary",plan:"中環見",status:"planned",result:""}]})});
  expect(db.tables.daily_tasks).toHaveLength(1);
  const task=db.tables.daily_tasks[0],info=decryptColumn(task.id,"info",task.info);
  expect(info).toMatchObject({name:"Mary",period:"afternoon",plan:"中環見",client_id:db.tables.clients[0].id});expect(info.time || "").toBe("");
  expect(send).toHaveBeenCalledWith("123",expect.stringContaining("下午"));
 });
 it("creates each name immediately with no invented details and reuses repeated names",async()=>{
  const db=coachingDatabase();await ensureNamedClients(db.db,"staff-a",["Mary","Peter"," Mary "]);
  expect(db.tables.clients).toHaveLength(2);for(const row of db.tables.clients)expect(Object.keys(decryptColumn(row.id,"info",row.info))).toEqual(["name"]);
  await ensureNamedClients(db.db,"staff-a",["mary"]);expect(db.tables.clients).toHaveLength(2);expect(db.rpc).toHaveBeenCalledTimes(2);
 });
 it("keeps the same name separate for different staff and never edits the existing customer's facts",async()=>{
  const db=coachingDatabase();await ensureNamedClients(db.db,"staff-a",["Mary"]);const row=db.tables.clients[0];row.info=encryptColumn(row.id,"info",row.info,{occupation:"會計",contact_history:"原記錄"});const original=structuredClone(row);
  await ensureNamedClients(db.db,"staff-a",["Mary"]);expect(db.tables.clients[0]).toEqual(original);
  await ensureNamedClients(db.db,"staff-b",["Mary"]);expect(db.tables.clients).toHaveLength(2);expect(db.tables.clients[1].id).not.toBe(row.id);expect(db.tables.clients[1].owner_id).toBe("staff-b");
 });
 it("asks about ambiguous existing names and does not create a duplicate",async()=>{
  const db=coachingDatabase();await ensureNamedClients(db.db,"staff-a",["陳大文","陳大明"]);const result=await ensureNamedClients(db.db,"staff-a",["陳大"]);expect(result.ambiguous).toEqual(["陳大"]);expect(db.tables.clients).toHaveLength(2);
 });
 it("a name-only message immediately creates the profile without requiring a confirmation",async()=>{
  const db=coachingDatabase(),send=vi.fn();
  await processIncoming({from:"123",messageId:"1",type:"text",text:"Mary"},"staff-a",db.db,send,"telegram",{today:empty.date,extract:async()=>({...empty,client_names:["Mary"]})});
  expect(db.tables.clients).toHaveLength(1);expect(db.tables.wa_drafts).toHaveLength(0);expect(send).toHaveBeenCalledWith("123",expect.stringContaining("已記低客戶姓名"));
 });
 it("creates the name-only profile and links a 15:00 appointment and automatically syncs its details",async()=>{
  const db=coachingDatabase(),send=vi.fn();
  await processIncoming({from:"123",messageId:"2",type:"text",text:"Mary 聽日下午三點見，35歲會計"},"staff-a",db.db,send,"telegram",{today:empty.date,extract:async()=>({...empty,client:{...empty.client,name:"Mary",age:"35",occupation:"會計"},client_names:["Mary"],tasks:[{operation:"create",day:"2026-11-09",time:"15:00",category:"appointment",stage:"",name:"Mary",plan:"appointment",status:"planned",result:""}]})});
  expect(db.tables.clients).toHaveLength(1);const client=db.tables.clients[0];expect(decryptColumn(client.id,"info",client.info)).toMatchObject({name:"Mary",age:"35",occupation:"會計"});expect(db.tables.daily_tasks).toHaveLength(1);expect(db.tables.wa_drafts).toHaveLength(1);
  await processIncoming({from:"123",messageId:"3",type:"text",text:"確認"},"staff-a",db.db,send,"telegram");
  expect(db.tables.daily_tasks).toHaveLength(1);const task=db.tables.daily_tasks[0];expect(decryptColumn(task.id,"info",task.info)).toMatchObject({client_id:client.id,time:"15:00",name:"Mary"});
 });
});
