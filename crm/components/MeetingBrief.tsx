import Link from "next/link";
import type {clientBrief} from "@/lib/coaching/summary";
export default function MeetingBrief({brief,clientName,ownerName,readOnly}:{clientName:string;brief:ReturnType<typeof clientBrief>;ownerName:string;readOnly:boolean}){
 return <section className="card meeting-brief" id="brief"><div className="row"><h2>{clientName} · 見客前簡報</h2><span className="badge badge-grey">負責：{ownerName}</span></div><p className="small muted">資料來自已保存記錄；未知或未講明嘅內容會列為待問。最後實際聯絡：{brief.lastContact||"未有記錄"}</p>
 <div className="brief-grid"><div><h3>上次傾過乜</h3>{brief.latest?<><p>{brief.latest.text}</p><p className="small muted">{brief.latest.day||brief.latest.at.slice(0,10)} · 已保存見客紀錄</p>{brief.latest.meeting?.response&&<p><b>客戶反應：</b>{brief.latest.meeting.response}</p>}{brief.latest.meeting?.blocker&&<p><b>卡位：</b>{brief.latest.meeting.blocker}</p>}{brief.latest.meeting?.needs_help&&<p className="notice">同事提出需要 Ryan 協助</p>}</>:<p className="muted">未有結構化見客紀錄，請先核對下方聯絡歷史。</p>}</div><div><h3>今次重點／下一步</h3>{brief.next?<p><b>{brief.next.day}{brief.next.time?` ${brief.next.time}`:""}</b><br/>{brief.next.plan}</p>:<p className="error">未有已安排嘅下一步。</p>}{brief.questions.length>0?<ul>{brief.questions.map(question=><li key={question}>{question}</li>)}</ul>:<p className="muted">主要欄位已有記錄，會面時再確認有冇改變。</p>}</div></div>
 <details><summary>查看已記錄資料（{brief.known.length}項）</summary><dl className="brief-facts">{brief.known.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.text}</dd></div>)}</dl></details>
 {!readOnly&&<div className="row"><a className="btn btn-primary" href="#meeting-note">記低今次見客結果</a><Link className="btn" href="#coaching">睇主管跟進</Link></div>}
 </section>;
}
