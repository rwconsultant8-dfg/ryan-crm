import Link from "next/link";
import {loadCalendarEntries,loadTeamCalendarEntries} from "@/lib/activity-data";
import {hkToday} from "@/lib/weeks";
import {loadFollowups} from "@/lib/planner-data";
import {loadCoaching} from "@/lib/coaching/store";
import {linkKnownTasks} from "@/lib/coaching/summary";
import Board from "@/components/Board";
import {matchesCustomerType} from "@/lib/customer-types";
import {requireUser,displayName,type Profile} from "@/lib/auth";
import {listClientCards,toBoardCards} from "@/lib/data";
export default async function BoardPage({searchParams}:{searchParams:Promise<{agent?:string;q?:string;focus?:string;type?:string}>}){
 const {supabase,profile}=await requireUser(),sp=await searchParams||{},isAdmin=profile.role==="admin";
 const people:Profile[]=isAdmin?((await supabase.from("profiles").select("id,email,full_name,role,active").order("full_name")).data||[]):[];
 const requested=sp.agent==="me"?profile.id:sp.agent,selected=isAdmin?(!requested||requested==="all"?"all":people.some(p=>p.id===requested)?requested:profile.id):profile.id;
 const owner=selected==="all"?undefined:selected,readOnly=owner!==profile.id,cards=await listClientCards(supabase,owner),today=hkToday();
 const results=await Promise.allSettled([loadFollowups(supabase,owner),owner?loadCalendarEntries(supabase,owner,today):loadTeamCalendarEntries(supabase,today),sp.focus==="coach"?loadCoaching(supabase,owner):Promise.resolve([])]);
 const tasks=results[0].status==="fulfilled"?linkKnownTasks(cards,results[0].value):undefined,appointments=results[1].status==="fulfilled"?results[1].value:undefined,notes=results[2].status==="fulfilled"?results[2].value:[];
 const query=(sp.q||"").trim().toLowerCase(),filterIds=new Set(notes.filter(n=>n.status!=="closed").map(n=>n.clientId));
 const filtered=cards.filter(c=>matchesCustomerType(c.info.customer_type,sp.type)&&(!query||c.info.name.toLowerCase().includes(query))&&(sp.focus!=="coach"||filterIds.has(c.id))),names=new Map(people.map(p=>[p.id,displayName(p)]));
 const boardCards=toBoardCards(filtered,tasks,appointments).map(card=>({...card,ownerName:isAdmin?names.get(cards.find(c=>c.id===card.id)!.owner_id):undefined}));
 return <><div className="section-heading"><div><h1>{selected==="all"?"全隊客戶":"客戶"}</h1><p className="muted">人脈同客戶進度已合併，同一份記錄跟到下一步。</p></div><div className="row"><span className="badge badge-grey">{filtered.length} 位客戶</span><Link className="btn btn-primary" href="/clients/new">＋ 新增客戶</Link>{isAdmin&&<Link className="btn" href="/admin">返回Ryan大佬bot總覽</Link>}</div></div>
 <form method="get" className="card coach-filters"><label className="field"><span>搵客戶</span><input type="text" name="q" defaultValue={sp.q||""} placeholder="輸入客戶姓名"/></label>{isAdmin&&<label className="field"><span>負責同事</span><select name="agent" defaultValue={selected}><option value="all">全隊同事（唯讀）</option>{people.map(p=><option key={p.id} value={p.id}>{displayName(p)}{p.id===profile.id?"（自己）":""}</option>)}</select></label>}<label className="field"><span>客戶類別</span><select name="type" defaultValue={sp.type||"all"}><option value="all">全部類別</option><option value="new">新客戶</option><option value="existing">現有客戶</option><option value="unclassified">未分類</option></select></label><label className="field"><span>顯示</span><select name="focus" defaultValue={sp.focus==="coach"?"coach":"all"}><option value="all">全部客戶</option><option value="coach">有未完成跟進事項</option></select></label><button className="btn" type="submit">篩選</button></form>
 {results.some(result=>result.status==="rejected")&&<p className="error" role="alert">部分跟進資料未能讀取，唔代表冇安排或跟進事項，請重新載入。</p>}
 {readOnly&&<p className="notice">主管查看模式：可以打開客戶簡報同留下主管指示；客戶資料由負責同事更新。</p>}
 <p className="muted small desktop-board-help">撳客戶睇簡報、見客紀錄同下一步。自己嘅客戶可以拖拉卡片轉進度。</p><Board cards={boardCards} simple={!isAdmin} readOnly={readOnly}/></>;
}
