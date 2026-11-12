import {describe,it,expect} from "vitest";
import {routingProbePassed} from "@/lib/codex/routing-probe";
import type {Extraction} from "@/lib/whatsapp/schema";
const good:Extraction={client:{name:"分類測試客戶",age:"50幾",gender:"",occupation:"會計",marital:""},fields:[{field:"form_rr.family",text:"兒子剛結婚"},{field:"form_rr.hobbies",text:"行山"},{field:"form_rr.personality",text:"希望60歲退休"},{field:"form_fna.income",text:"50000"}],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:"2026-11-06",summary:"已見客",meeting:{occurred:true,summary:"已見面了解情況",response:"想睇清楚現有保單",blocker:"未搵齊舊保單",needs_help:true,next_step:"聯絡收集舊保單",next_day:"2026-11-07"},tasks:[{operation:"create",day:"2026-11-07",category:"planning",stage:"",name:"分類測試客戶",plan:"聯絡收集舊保單",status:"planned",result:""}]};
describe("live classification probe assertions",()=>{
 it("accepts explicit age, correct family subject, income and goal placement",()=>expect(routingProbePassed(good,"2026-11-06")).toBe(true));
 it("rejects the reported age misplacement, false precision and marriage inference",()=>{expect(routingProbePassed({...good,client:{...good.client,age:"50"}})).toBe(false);expect(routingProbePassed({...good,client:{...good.client,marital:"married"}})).toBe(false);expect(routingProbePassed({...good,fields:good.fields.map(f=>f.field==="form_rr.personality"?{...f,text:"50幾歲，性格保守，希望60歲退休"}:f)})).toBe(false);});
 it("rejects missing meeting, completed future task or wrong dates",()=>{expect(routingProbePassed({...good,meeting:undefined})).toBe(false);expect(routingProbePassed({...good,tasks:good.tasks!.map(t=>({...t,status:"done"}))})).toBe(false);expect(routingProbePassed(good,"2026-11-05")).toBe(false);});
});
