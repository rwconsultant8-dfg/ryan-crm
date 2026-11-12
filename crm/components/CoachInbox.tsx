import Link from "next/link";
import type {CoachingNote} from "@/lib/coaching/types";
export default function CoachInbox({notes,names,ownerQuery=""}:{notes:CoachingNote[];names:Record<string,string>;ownerQuery?:string}){
 const active=notes.filter(note=>note.status!=="closed");if(!active.length)return null;
 return <section className="card coach-inbox"><div className="row"><h2>Ryan 嘅跟進事項</h2><span className="badge badge-yellow">{active.length}</span></div>{active.slice(0,3).map(note=><article key={note.id}><strong>{names[note.clientId]||"客戶"}</strong><p>{note.request}</p><p className="small muted">{note.dueDay?`期限 ${note.dueDay}`:"未指定期限"} · {note.status==="replied"?"已回覆，等主管核對":"等你處理及回覆"}</p><Link className="btn" href={`/clients/${note.clientId}#coaching`}>打開事項／回覆結果</Link></article>)}{active.length>3&&<Link href={`/board?focus=coach${ownerQuery}`}>查看全部相關客戶</Link>}</section>;
}
