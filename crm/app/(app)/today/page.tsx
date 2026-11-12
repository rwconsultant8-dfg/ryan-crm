import Link from "next/link";
import { requireUser, displayName, type Profile } from "@/lib/auth";
import { resolveViewedOwner } from "@/lib/viewing";
import { loadFollowups, loadTasks } from "@/lib/planner-data";
import { loadCalendarEntries } from "@/lib/activity-data";
import { listClientCards } from "@/lib/data";
import { nextClientStep } from "@/lib/followups";
import { addDays, hkToday, isDate, mondayOf } from "@/lib/weeks";
import PersonalCover from "@/components/PersonalCover";
import {getProfileAvatar} from "@/lib/profile-avatar";
import CoachInbox from "@/components/CoachInbox";
import {loadCoaching} from "@/lib/coaching/store";
import DailyPlanner from "@/components/DailyPlanner";
import TeamDailyTasks from "@/components/TeamDailyTasks";

function TaskViews({ team, day, personal }: { team: boolean; day: string; personal: boolean }) {
  return (
    <nav className="week-toolbar" aria-label="每日任務檢視">
      <Link className={`btn btn-sm${personal ? " btn-primary" : ""}`} aria-current={personal ? "page" : undefined} href={`/today?day=${day}`}>我的任務</Link>
      <Link className={`btn btn-sm${team ? " btn-primary" : ""}`} aria-current={team ? "page" : undefined} href={`/today?view=team&day=${day}`}>團隊任務</Link>
    </nav>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ week?: string; day?: string; view?: string; agent?: string; client?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const isAdmin = profile.role === "admin";
  const today = hkToday();
  const requestedDay = isDate(sp.day) ? sp.day : undefined;
  const monday = mondayOf(isDate(sp.week) ? sp.week : requestedDay ?? today);
  const sunday = addDays(monday, 6);
  const day = requestedDay && requestedDay >= monday && requestedDay <= sunday
    ? requestedDay
    : today >= monday && today <= sunday ? today : monday;

  if (isAdmin && sp.view === "team") {
    const selectedDay = requestedDay ?? day;
    let data = null;
    try {
      const [tasks, people] = await Promise.all([
        loadTasks(supabase, selectedDay, selectedDay),
        supabase.from("profiles").select("id,email,full_name,active").order("full_name"),
      ]);
      if (people.error) throw new Error("未能讀取同事名單");
      data = { tasks, people: (people.data ?? []) as Pick<Profile, "id" | "email" | "full_name" | "active">[] };
    } catch {
      // Keep the date navigation available when the data cannot be read.
    }
    return <>
      <TaskViews team day={selectedDay} personal={false} />
      <TeamDailyTasks data={data} day={selectedDay} today={today} viewerId={profile.id} />
    </>;
  }

  const { owner, readOnly } = await resolveViewedOwner(supabase, profile, sp.agent);
  const simple = !isAdmin;
  const views = isAdmin ? <TaskViews team={false} day={day} personal={!readOnly} /> : null;
  try {
    const coaching=await loadCoaching(supabase,owner.id).catch(()=>null);
    const [allTasks, cards, appointments,avatar] = await Promise.all([loadFollowups(supabase,owner.id),listClientCards(supabase,owner.id),loadCalendarEntries(supabase,owner.id,today),readOnly?Promise.resolve(null):getProfileAvatar(profile).catch(()=>null)]);
    const tasks = allTasks.filter(t=>t.day>=monday && t.day<=sunday);
    const clients = cards.map(c=>({id:c.id,name:c.info.name}));
    const missingClients = cards.filter(c=>c.stage!=="SIGNED" && c.stage!=="ISSUED" && !nextClientStep(allTasks,appointments,c.id,today)).map(c=>({id:c.id,name:c.info.name}));
    const url = (w:string)=>`/today?week=${w}${readOnly ? `&agent=${owner.id}` : ""}`;
    return <>
      {views}
      {!readOnly&&<PersonalCover name={displayName(profile)} avatar={avatar} today={today}/>}
      <div className="section-heading journal-section-heading"><div>{readOnly?<h1>{displayName(owner)} 嘅安排</h1>:<h2>今日安排</h2>}<p className="muted small">{readOnly?"同事嘅計劃、行程同跟進記錄。":"由眼前最重要嘅一件事開始。"}</p></div>{readOnly&&<span className="badge badge-grey">主管唯讀</span>}</div>
      <details className="week-selector" open={!simple}><summary>查看其他星期</summary><div className="week-toolbar"><Link className="btn btn-sm" href={url(addDays(monday,-7))}>← 上週</Link><span>{monday} — {addDays(monday,6)}</span><Link className="btn btn-sm" href={url(addDays(monday,7))}>下週 →</Link><Link href={url(mondayOf(today))}>返今週</Link></div></details>
      {coaching===null?<p className="error" role="alert">跟進事項暫時未能讀取，請稍後重新載入。</p>:<CoachInbox notes={coaching} names={Object.fromEntries(cards.map(c=>[c.id,c.info.name]))} ownerQuery={readOnly?`&agent=${owner.id}`:""}/>}
      <DailyPlanner key={`${owner.id}:${monday}:${day}`} initialDay={day} tasks={tasks} focusTasks={allTasks} appointments={appointments} clients={clients} missingClients={missingClients} initialClient={clients.some(c=>c.id===sp.client) ? sp.client : ""} ownerQuery={readOnly ? `&agent=${owner.id}` : ""} monday={monday} today={today} readOnly={readOnly} simple={simple} showIntro={false}/>
    </>;
  } catch { return <>{views}<h1>每日任務</h1><p className="error" role="alert">暫時未能讀取跟進安排，請稍後重新載入。客戶進度仍可由上方導覽開啟。</p></>; }
}
