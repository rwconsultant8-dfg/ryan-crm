"use client";
import Link from "next/link";
import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { addContactEventAction } from "@/app/(app)/clients/actions";
import type { Task } from "@/lib/planner";
import { STATUSES } from "@/lib/planner";
import type { CalendarEntry, ContactEvent } from "@/lib/followups";


export default function ClientFollowups({clientId,tasks,appointments,history,today,readOnly}:{clientId:string;tasks:Task[];appointments:CalendarEntry[];history:ContactEvent[];today:string;readOnly:boolean}) {
  const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null),[pending,start]=useTransition();
  const router=useRouter();
  const events = [
    ...history.map(e=>({id:e.id,when:e.day || e.at.slice(0,10),label:e.kind==="contact" ? "聯絡記錄" : "備註",text:e.text})),
    ...tasks.map(t=>({id:t.id,when:`${t.day} ${t.time || ""}`,label:`任務 · ${STATUSES[t.status]}`,text:`${t.plan}${t.result ? `\n結果：${t.result}` : ""}`})),
    ...appointments.map(a=>({id:`${a.day}:${a.slot}`,when:`${a.day} ${a.time || ""}`,label:`${a.label} appointment${a.day>=today ? " · 已安排" : " · 行程記錄"}`,text:a.text})),
  ].sort((a,b)=>b.when.localeCompare(a.when));
  return <section className="client-followups">
    <div className="section-heading"><div><span className="eyebrow">RELATIONSHIP JOURNEY</span><h2>跟進旅程</h2></div>{!readOnly && <div className="row"><Link className="btn btn-primary" href={`/today?client=${clientId}#new-plan`}>＋ 安排下一步</Link><Link className="btn" href={`/activity?client=${clientId}`}>安排 appointment</Link></div>}</div>
    {!readOnly && <details className="card contact-composer"><summary>＋ 內部備註</summary><form onSubmit={e=>{
      e.preventDefault(); const form=e.currentTarget,values=new FormData(form);
      start(async()=>{try {const r=await addContactEventAction(clientId,String(values.get("text")||""),String(values.get("kind")||""),String(values.get("day")||""));setMessage(r.ok?{ok:true,text:"已記低，下一次跟進前可以隨時睇返。"}:{ok:false,text:r.error});if(r.ok){form.reset();router.refresh();}}catch{setMessage({ok:false,text:"儲存失敗，請重試。"});}});
    }}><input type="hidden" name="kind" value="note"/><div className="grid-2"><label className="field"><span>日期</span><input name="day" type="date" defaultValue={today} max={today} required disabled={pending}/></label></div><label className="field"><span>補充備註（唔會當成已見客）</span><textarea name="text" maxLength={2000} required disabled={pending} placeholder="例如：下次要帶嘅資料或其他內部提醒"/></label><button className="btn btn-primary" disabled={pending}>{pending?"儲存中…":"儲存備註"}</button>{message&&<p role={message.ok?"status":"alert"} className={message.ok?"notice":"error"}>{message.text}</p>}</form></details>}
    <details className="history contact-history"><summary>過往跟進記錄（{events.length}）</summary><div className="contact-timeline">{events.length ? events.map(e=><article key={e.id}><span className="timeline-point" aria-hidden="true"/><span className="small muted">{e.when} · {e.label}</span><p>{e.text || "已安排見面"}</p></article>) : <p className="muted">旅程由第一個聯絡開始，見面後記低重點，下一次就唔使由頭諗。</p>}</div></details>
  </section>;
}
