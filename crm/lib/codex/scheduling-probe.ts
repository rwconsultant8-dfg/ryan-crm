import type {Extraction} from "../whatsapp/schema";
import {addDays} from "../weeks";
export const SCHEDULING_PROBES=["schedule-v1","reschedule-v1"] as const;
export const schedulingProbeId=(probe:typeof SCHEDULING_PROBES[number])=>`codex-${probe}`;
export function schedulingProbeText(probe:typeof SCHEDULING_PROBES[number],today:string){
 const day=addDays(today,1);
 if(probe==="schedule-v1")return "新客Mary聽日下午三點中環見。另外有個新客叫Peter，暫時得個名。";
 return `Mary原定聽日下午三點嘅appointment，改到聽日下午四點。\n\n已儲存嘅本人安排（只作配對參考）：${JSON.stringify({tasks:[{id:"00000000-0000-4000-8000-000000000123",name:"Mary",day,time:"15:00",category:"appointment",stage:"",status:"planned",plan:"中環見面"}],calendar:[]})}`;
}
/** Synthetic input only: never passed to profile creation, preview or customer writes. */
export function schedulingProbePassed(e:Extraction,probe:typeof SCHEDULING_PROBES[number],today:string){
 if(e.clarification?.trim() || e.meeting?.occurred || e.appointment.slot || e.fields.length)return false;
 if(!e.client_names?.includes("Mary"))return false;
 const t=e.tasks?.find(t=>t.name==="Mary");
 if(!t || t.category!=="appointment" || t.status!=="planned" || t.day!==addDays(today,1))return false;
 if(probe==="schedule-v1")return t.operation==="create" && t.time==="15:00" && e.client_names.includes("Peter");
 return t.operation==="reschedule" && t.task_id==="00000000-0000-4000-8000-000000000123" && t.new_day===addDays(today,1) && t.time==="16:00";
}
