"use client";
import {useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {createCoachingAction,respondCoachingAction} from "@/app/(app)/clients/coaching-actions";
import type {CoachingNote} from "@/lib/coaching/types";
const labels={open:"等同事處理",replied:"同事已回覆，等 Ryan 核對",closed:"主管已確認完成"};
function RequestCard({note,isAdmin,isOwner}:{note:CoachingNote;isAdmin:boolean;isOwner:boolean}){
 const [pending,start]=useTransition(),[error,setError]=useState(""),router=useRouter();
 return <article className="coach-request"><div className="row"><strong>{note.authorName} 嘅主管指示</strong><span className={`badge ${note.status==="closed"?"badge-green":"badge-yellow"}`}>{labels[note.status]}</span></div><p>{note.request}</p><p className="small muted">{note.createdAt.slice(0,10)} · {note.dueDay?`期限 ${note.dueDay}`:"期限未指定"}</p>{note.reply&&<div className="coach-reply"><b>同事處理結果</b><p>{note.reply}</p></div>}
  {isOwner&&note.status!=="closed"&&<details><summary>回覆處理結果</summary><form onSubmit={event=>{event.preventDefault();const reply=String(new FormData(event.currentTarget).get("reply")||"");start(async()=>{try{const r=await respondCoachingAction({id:note.id,revision:note.revision,reply,close:false});setError(r.error);if(r.ok)router.refresh();}catch{setError("未能確認回覆結果，請重新載入。");}});}}><label className="field"><span>已做咗乜？結果同下一步係乜？</span><textarea name="reply" defaultValue={note.reply} maxLength={1500} required disabled={pending}/></label><button className="btn btn-primary" disabled={pending}>提交回覆</button></form></details>}
  {isAdmin&&note.status!=="closed"&&<button className="btn btn-sm" disabled={pending} onClick={()=>start(async()=>{try{const r=await respondCoachingAction({id:note.id,revision:note.revision,reply:"",close:true});setError(r.error);if(r.ok)router.refresh();}catch{setError("未能確認完成，請重新載入。");}})}>核對後標記完成</button>}{error&&<p className="error" role="alert">{error}</p>}
 </article>;
}
export default function CoachingPanel({clientId,notes,isAdmin,isOwner,today}:{clientId:string;notes:CoachingNote[];isAdmin:boolean;isOwner:boolean;today:string}){
 const [pending,start]=useTransition(),[error,setError]=useState(""),operation=useRef<string|null>(null),router=useRouter(),active=notes.filter(n=>n.status!=="closed"),closed=notes.filter(n=>n.status==="closed");
 return <section className="card coaching-panel" id="coaching"><div className="row"><h2>ZEST 團隊助手跟進</h2><span className="badge badge-grey">{active.length} 項未完成</span></div><p className="muted small">主管指示同客戶實際見面記錄分開；同事回覆後，由主管核對完成。</p>
 {isAdmin&&<details><summary>＋ 留下指示／安排下一步</summary><form onSubmit={event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);operation.current??=crypto.randomUUID();const id=operation.current;start(async()=>{try{const result=await createCoachingAction({id,clientId,request:String(data.get("request")||""),dueDay:String(data.get("dueDay")||"")});setError(result.error);if(result.ok){operation.current=null;form.reset();router.refresh();}}catch{setError("未能確認儲存，請重試。");}});}}><label className="field"><span>同事要做乜／Ryan 會點協助</span><textarea name="request" required maxLength={1500} disabled={pending}/></label><label className="field"><span>處理期限（可留空）</span><input type="date" name="dueDay" min={today} disabled={pending}/></label><button className="btn btn-primary" disabled={pending}>交代跟進事項</button>{error&&<p className="error" role="alert">{error}</p>}</form></details>}
 {active.length?active.map(note=><RequestCard key={note.id} note={note} isAdmin={isAdmin} isOwner={isOwner}/>):<p className="muted">暫時冇未完成嘅主管指示。</p>}{closed.length>0&&<details><summary>已完成事項（{closed.length}）</summary>{closed.map(note=><RequestCard key={note.id} note={note} isAdmin={isAdmin} isOwner={isOwner}/>)}</details>}
 </section>;
}
