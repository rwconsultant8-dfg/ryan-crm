"use client";
import {useRef,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {saveMeetingAction} from "@/app/(app)/clients/meeting-actions";
export default function MeetingNote({clientId,today}:{clientId:string;today:string}){
 const [pending,start]=useTransition(),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null),operation=useRef<string|null>(null),router=useRouter();
 return <details className="card meeting-composer" id="meeting-note"><summary>＋ 見客後整理</summary><p className="muted">可以<a href="https://t.me/Ryan_main_bot" target="_blank" rel="noreferrer">私訊 Ryan大佬bot</a>一次交代，或者喺下面填寫。講清楚傾過乜、客戶反應、卡住原因同下一步。未定日期可以留空，主管會睇到待安排。</p><form onSubmit={event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);operation.current??=crypto.randomUUID();const id=operation.current;start(async()=>{try{const result=await saveMeetingAction({id,clientId,day:String(data.get("day")||""),summary:String(data.get("summary")||""),response:String(data.get("response")||""),blocker:String(data.get("blocker")||""),needs_help:data.get("needs_help")==="on",next_step:String(data.get("next_step")||""),next_day:String(data.get("next_day")||"")});setMessage({ok:result.ok,text:result.ok?"見客紀錄已保存；有日期嘅下一步已加入每日任務。":result.error});if(result.ok){operation.current=null;form.reset();router.refresh();}}catch{setMessage({ok:false,text:"未能確認儲存結果，請用同一份資料重試。"});}});}}>
  <label className="field"><span>實際見客／聯絡日期</span><input type="date" name="day" defaultValue={today} max={today} required disabled={pending}/></label>
  <label className="field"><span>今次傾過乜／結果</span><textarea name="summary" maxLength={1500} required disabled={pending} placeholder="例如：已了解家庭情況，客戶想先睇返現有安排"/></label>
  <div className="grid-2"><label className="field"><span>客戶實際反應</span><textarea name="response" maxLength={1000} disabled={pending} placeholder="記錄客戶講過嘅話，未講可以留空"/></label><label className="field"><span>卡住原因／未解決問題</span><textarea name="blocker" maxLength={1000} disabled={pending}/></label></div>
  <label className="field"><span>下一步做乜</span><input name="next_step" type="text" maxLength={1000} disabled={pending}/></label><label className="field"><span>下一步日期（未定可留空）</span><input name="next_day" type="date" min={today} disabled={pending}/></label>
  <label className="coaching-check"><input type="checkbox" name="needs_help" disabled={pending}/>需要 Ryan 協助／陪同</label><button className="btn btn-primary" disabled={pending}>{pending?"儲存中…":"儲存見客結果及下一步"}</button>{message&&<p role={message.ok?"status":"alert"} className={message.ok?"notice":"error"}>{message.text}</p>}
 </form></details>;
}
