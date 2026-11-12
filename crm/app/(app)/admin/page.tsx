import {requireAdmin,displayName,type Profile} from "@/lib/auth";
import {listClientCards} from "@/lib/data";
import {loadFollowups} from "@/lib/planner-data";
import {loadTeamCalendarEntries} from "@/lib/activity-data";
import {loadCoaching} from "@/lib/coaching/store";
import {coachRows,linkKnownTasks} from "@/lib/coaching/summary";
import {hkToday,isDate,mondayOf} from "@/lib/weeks";
import PersonalCover from "@/components/PersonalCover";
import {getProfileAvatar} from "@/lib/profile-avatar";
import CoachOverview from "@/components/CoachOverview";
export default async function AdminOverview({searchParams}:{searchParams:Promise<{week?:string}>}){
 const {supabase,profile}=await requireAdmin(),sp=await searchParams||{},today=hkToday(),monday=mondayOf(isDate(sp.week)?sp.week:today);
 const [{data:people,error},cards,avatar]=await Promise.all([supabase.from("profiles").select("id,email,full_name,role,active").order("full_name"),listClientCards(supabase),getProfileAvatar(profile).catch(()=>null)]);
 if(error)return <><h1>ZEST 團隊助手總覽</h1><p className="error" role="alert">未能讀取同事名單，請重新載入。</p></>;
 const staff=((people||[]) as Profile[]).filter(p=>p.active||cards.some(c=>c.owner_id===p.id)),names=new Map(staff.map(p=>[p.id,displayName(p)]));
 const results=await Promise.allSettled([loadFollowups(supabase),loadTeamCalendarEntries(supabase,today),loadCoaching(supabase)]);
 const tasks=results[0].status==="fulfilled"?results[0].value:[],appointments=results[1].status==="fulfilled"?results[1].value:[],notes=results[2].status==="fulfilled"?results[2].value:[];
 const unavailable=results.flatMap((result,i)=>result.status==="rejected"?[ ["團隊待辦","日曆","跟進事項"][i] ]:[]),rows=coachRows(cards,tasks,appointments,notes,names,today),linked=linkKnownTasks(cards,tasks);
 return <><PersonalCover name={displayName(profile)} avatar={avatar} today={today} manager/><CoachOverview rows={rows} people={staff.map(p=>({id:p.id,name:displayName(p),active:p.active}))} tasks={tasks} unlinkedTasks={linked.filter(t=>!t.client_id)} today={today} monday={monday} unavailable={unavailable} hasCover/></>;
}
