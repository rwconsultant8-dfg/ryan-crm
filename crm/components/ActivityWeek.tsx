"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveActivityWeekAction } from "@/app/(app)/activity/actions";
import {isCalendarTask} from "@/lib/calendar-tasks";
import { APPT_SLOTS, appointmentSlot, appointmentTimeLabel } from "@/lib/activity";
import { appointmentClientKey, appointmentTimeKey, type ClientOption } from "@/lib/followups";
import type { Task } from "@/lib/planner";
import { WEEKDAY_LABELS, shortDate } from "@/lib/weeks";

export type WeekDay = { day:string; appts:Record<string,string> };
function AppointmentCell({ day, slot, clients, disabled, readOnly, initialClient, tasks, ownerQuery, edit }: {
  day:WeekDay; slot:typeof APPT_SLOTS[number]; clients:ClientOption[]; disabled:boolean; readOnly:boolean; initialClient:string; tasks:Task[]; ownerQuery:string;
  edit:(key:string,value:string)=>void;
}) {
  const key = appointmentClientKey(slot.key), timeKey = appointmentTimeKey(slot.key);
  const selected = day.appts[key] || "";
  const client = clients.find(c=>c.id===selected);
  const text = day.appts[slot.key] || "";
  const time = day.appts[timeKey] || "";
  return <article className={`calendar-cell ${text || selected || tasks.length ? "has-appointment" : ""}`}>
    <div className="row"><span className="slot-symbol" aria-hidden="true">{slot.key==="breakfast" ? "☀" : slot.key==="dinner" ? "☾" : "◌"}</span><strong>{slot.label}</strong><span className="spacer"/><small className="muted">{time || slot.time}</small></div>
    {(text || selected) && <div className="appointment-summary">{client && <Link href={`/clients/${client.id}`}>{client.name || "未命名客戶"} ↗</Link>}<p>{text}</p></div>}
    {tasks.map(t=><article className="calendar-task" key={t.id}><span className="badge badge-grey">見面{t.status==="done" ? " · 已完成" : ""}</span><strong>{appointmentTimeLabel(t.time,t.period)} · {t.client_id ? <Link href={`/clients/${t.client_id}`}>{t.name} ↗</Link> : t.name}</strong><p>{t.plan}</p><Link href={`/today?week=${day.day}${ownerQuery}`}>查看安排 →</Link></article>)}
    {!readOnly && <details><summary>{text || selected ? "編輯安排" : "＋ 安排 appointment"}</summary>
      <label className="field"><span>連結客戶</span><select aria-label={`${day.day} ${slot.label}客戶`} disabled={disabled} value={selected} onChange={e=>edit(key,e.target.value)}><option value="">暫不連結</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name || "未命名客戶"}</option>)}</select></label>
      {initialClient && !selected && <button className="btn btn-sm" disabled={disabled} onClick={()=>edit(key,initialClient)}>揀返剛才嘅客戶</button>}
      <label className="field"><span>時間</span><input aria-label={`${day.day} ${slot.label}時間`} type="time" disabled={disabled} value={time} onChange={e=>edit(timeKey,e.target.value)}/></label>
      <label className="field"><span>地點／內容</span><textarea aria-label={`${day.day} ${slot.label} appointment`} disabled={disabled} maxLength={300} value={text} placeholder="記低地點同見面重點" onChange={e=>edit(slot.key,e.target.value)}/></label>
    </details>}
    {readOnly && !text && !selected && !tasks.length && <p className="muted small">未有安排</p>}
  </article>;
}
export default function ActivityWeek({days:initial,today,readOnly,clients=[],tasks=[],initialClient="",ownerQuery=""}:{
  days:WeekDay[];today:string;readOnly:boolean;clients?:ClientOption[];tasks?:Task[];initialClient?:string;ownerQuery?:string;
}) {
  const router=useRouter();
  const [days,setDays]=useState(initial),[dirty,setDirty]=useState<Set<string>>(new Set());
  const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null),[pending,start]=useTransition();
  const [active,setActive]=useState(Math.max(0,initial.findIndex(d=>d.day===today)));
  useEffect(()=>{setDays(initial);setDirty(new Set());},[initial]);
  useEffect(()=>{if(!dirty.size)return;const guard=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  function edit(i:number,key:string,value:string){
    setDays(ds=>ds.map((d,j)=>i===j?{...d,appts:{...d.appts,[key]:value}}:d));
    setDirty(d=>new Set(d).add(days[i].day));setMessage(null);
  }
  function save(){start(async()=>{
    try {const result=await saveActivityWeekAction(days[0].day,days.filter(d=>dirty.has(d.day)));
      setMessage(result.ok?{ok:true,text:"日曆已儲存，客戶頁會同步顯示。"}:{ok:false,text:result.error});
      if(result.ok){setDirty(new Set());router.refresh();}
    } catch {setMessage({ok:false,text:"未能儲存，請重試。"});}
  });}
  return <>
    <p className="muted">上午、中午、下午、晚上。講明時間或時段嘅見面安排會自動放入對應位置，並同步顯示喺客戶頁。</p>
    <div className="calendar-mobile-days" role="group" aria-label="選擇日曆日期">{days.map((d,i)=><button className={`btn ${active===i ? "btn-primary" : ""}`} key={d.day} aria-pressed={active===i} onClick={()=>setActive(i)}>{WEEKDAY_LABELS[i].replace("星期","")}<small>{shortDate(d.day)}</small></button>)}</div>
    <div className="calendar-week" aria-label="每週日曆">{days.map((d,i)=><section key={d.day} className={`calendar-day ${active===i?"selected-day":""} ${d.day===today?"is-today":""}`}>
      <header><span>{WEEKDAY_LABELS[i]}{d.day===today && " · 今日"}</span><strong>{shortDate(d.day)}</strong>{dirty.has(d.day)&&<span className="badge badge-yellow">未儲存</span>}</header>
      {APPT_SLOTS.map(s=><AppointmentCell key={s.key} day={d} slot={s} clients={clients} disabled={readOnly||pending} readOnly={readOnly} initialClient={initialClient} ownerQuery={ownerQuery} tasks={tasks.filter(t=>t.day===d.day && isCalendarTask(t) && appointmentSlot(t.time,t.period)===s.key)} edit={(key,value)=>edit(i,key,value)}/>)}
      {tasks.filter(t=>t.day===d.day && isCalendarTask(t) && !appointmentSlot(t.time,t.period)).map(t=><article className="calendar-task" key={t.id}><span className="badge badge-grey">見面{t.status==="done" ? " · 已完成" : ""}</span><strong>{appointmentTimeLabel(t.time,t.period) || "時間待定"} · {t.name}</strong><p>{t.plan}</p><Link href={`/today?week=${days[0].day}${ownerQuery}`}>查看任務 →</Link></article>)}
    </section>)}</div>
    {!readOnly && <div className="savebar"><button className="btn btn-primary" onClick={save} disabled={pending||!dirty.size}>{pending?"儲存中…":"儲存日曆"}</button>{dirty.size>0&&<span className="small muted">{dirty.size} 日有變更</span>}{message&&<span role={message.ok?"status":"alert"} className={message.ok?"notice":"error"}>{message.text}</span>}</div>}
  </>;
}
