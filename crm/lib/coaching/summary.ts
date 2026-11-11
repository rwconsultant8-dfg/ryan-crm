import type {ClientCard,ClientFull} from "../data";
import type {Task} from "../planner";
import type {CalendarEntry,ContactEvent} from "../followups";
import {readContactHistory,nextClientStep,isOpenTask} from "../followups";
import {meetingSchema} from "../meeting";
import {addDays,isDate} from "../weeks";
import {ageLabel} from "../age";
import type {CoachingNote} from "./types";
export function meetingsOf(raw?:string){return readContactHistory(raw).filter(event=>event.kind==="contact"&&meetingSchema.safeParse(event.meeting).success&&event.meeting?.occurred).sort((a,b)=>(b.day||b.at.slice(0,10)).localeCompare(a.day||a.at.slice(0,10))||b.at.localeCompare(a.at));}
export function lastContactOf(client:ClientCard,today:string){const dates=[client.info.last_contact_at?.slice(0,10),...readContactHistory(client.info.contact_history).filter(e=>e.kind==="contact").map(e=>e.day||e.at.slice(0,10))].filter((day):day is string=>Boolean(day&&isDate(day)&&day<=today));return dates.sort().at(-1)||"";}
export function linkKnownTasks(cards:ClientCard[],tasks:Task[]){
 const byId=new Map(cards.map(c=>[c.id,c]));
 return tasks.map(task=>{if(task.client_id){const client=byId.get(task.client_id);return client?.owner_id===task.owner_id?task:{...task,client_id:""};}const same=cards.filter(c=>c.owner_id===task.owner_id&&c.info.name.trim().toLowerCase()===task.name.trim().toLowerCase());return same.length===1?{...task,client_id:same[0].id}:task;});
}
export type CoachRow={id:string;name:string;ownerId:string;ownerName:string;stage:ClientCard["stage"];lastContact:string;latestMeeting:ContactEvent|null;next:ReturnType<typeof nextClientStep>;overdue:number;missingNext:boolean;stale:boolean;help:boolean;notes:CoachingNote[];attention:number};
export function coachRows(cards:ClientCard[],tasks:Task[],appointments:(CalendarEntry&{owner_id?:string})[],notes:CoachingNote[],names:Map<string,string>,today:string):CoachRow[]{
 const linked=linkKnownTasks(cards,tasks);
 return cards.map(client=>{
   const mine=linked.filter(t=>t.owner_id===client.owner_id&&t.client_id===client.id),events=appointments.filter(a=>a.client_id===client.id&&(!a.owner_id||a.owner_id===client.owner_id));
   const next=nextClientStep(mine,events,client.id,today),lastContact=lastContactOf(client,today),latestMeeting=meetingsOf(client.info.contact_history).find(e=>(e.day||e.at.slice(0,10))<=today)||null;
   const requests=notes.filter(n=>n.clientId===client.id&&n.ownerId===client.owner_id),active=requests.filter(n=>n.status!=="closed");
   const help=Boolean(latestMeeting?.meeting?.needs_help&&!requests.some(n=>n.status==="closed"&&(n.revision||n.createdAt)>=latestMeeting.at));
   const overdue=mine.filter(t=>isOpenTask(t)&&t.day<today).length+active.filter(n=>n.dueDay&&n.dueDay<today).length,open=client.stage!=="SIGNED"&&client.stage!=="ISSUED",missingNext=open&&!next,stale=Boolean(open&&lastContact&&lastContact<addDays(today,-14));
   return{id:client.id,name:client.info.name||"未命名客戶",ownerId:client.owner_id,ownerName:names.get(client.owner_id)||"同事",stage:client.stage,lastContact,latestMeeting,next,overdue,missingNext,stale,help,notes:active,attention:overdue*10+(help?8:0)+active.filter(n=>n.status==="replied").length*5+active.filter(n=>n.status==="open").length*2+(missingNext?3:0)+(stale?1:0)};
 }).sort((a,b)=>b.attention-a.attention||(a.next?.day||"9999").localeCompare(b.next?.day||"9999")||a.name.localeCompare(b.name));
}
export function clientBrief(client:ClientFull,tasks:Task[],appointments:CalendarEntry[],today:string){
 const forms=client.forms,latest=meetingsOf(client.info.contact_history).find(e=>(e.day||e.at.slice(0,10))<=today)||null;
 const known=[{label:"年齡",text:client.info.age?ageLabel(client.info.age):""},{label:"職業",text:client.info.occupation},{label:"家庭",text:forms.form_rr?.family},{label:"已表達需要",text:forms.form_rr?.needs},{label:"人生目標",text:forms.form_rr?.personality},{label:"現有配置",text:forms.form_rr?.existing},{label:"已交代預算",text:forms.form_nr2?.budget_text}].filter(item=>item.text?.trim()).map(item=>({...item,text:item.text!.trim().slice(0,400)}));
 const questions:string[]=[];
 if(!forms.form_rr?.needs?.trim())questions.push("今次最想解決邊個問題？客戶最重視乜？");
 if(!forms.form_rr?.existing?.trim())questions.push("現有保障／理財安排係點？有冇資料可以核對？");
 if(!forms.form_nr2?.budget_text?.trim())questions.push("客戶願意同能夠安排嘅預算係幾多？");
 if(!client.info.age)questions.push("客戶大概年齡係幾多？");
 if(!forms.form_rr?.family?.trim())questions.push("家庭情況同需要照顧嘅人有邊啲？");
 const linked=tasks.filter(t=>t.client_id===client.id&&t.owner_id===client.owner_id);
 return{known,questions:questions.slice(0,4),latest,lastContact:lastContactOf(client,today),next:nextClientStep(linked,appointments,client.id,today),openTasks:linked.filter(isOpenTask).sort((a,b)=>a.day.localeCompare(b.day)).slice(0,5)};
}
