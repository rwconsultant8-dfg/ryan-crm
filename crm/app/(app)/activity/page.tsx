import Link from "next/link";
import ActivityWeek from "@/components/ActivityWeek";
import { requireUser, displayName, type Profile } from "@/lib/auth";
import { canViewTeamCalendar } from "@/lib/member-identity";
import {isCalendarTask} from "@/lib/calendar-tasks";
import { loadFollowups } from "@/lib/planner-data";
import { listClientCards } from "@/lib/data";
import { loadWeek } from "@/lib/activity-data";
import { addDays, hkToday, isDate, isoWeek, mondayOf, shortDate } from "@/lib/weeks";

function CalendarFilters({ people, ownerId, monday }: { people: Profile[]; ownerId: string; monday: string }) {
  return <section className="card" aria-label="團隊日曆">
    <h2>同事日曆</h2>
    <nav className="row" aria-label="選擇同事日曆" style={{flexWrap:"wrap",gap:8,marginBottom:12}}>
      {people.map(person=><Link key={person.id} className={`btn btn-sm${person.id===ownerId ? " btn-primary" : ""}`} aria-current={person.id===ownerId ? "page" : undefined} href={`/activity?week=${monday}&agent=${person.id}`}>{displayName(person)}{person.active ? "" : "（已停用）"}</Link>)}
    </nav>
    <form key={`${ownerId}:${monday}`} action="/activity" method="get" className="coach-filters">
    <input type="hidden" name="week" value={monday} />
    <label className="field"><span>查看同事日曆</span><select name="agent" defaultValue={ownerId}>
      {people.map((person) => <option key={person.id} value={person.id}>{displayName(person)}{person.active ? "" : "（已停用）"}</option>)}
    </select></label>
    <button className="btn btn-primary" type="submit">查看日曆</button>
    </form>
  </section>;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ week?: string; agent?: string; client?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const teamCalendar = canViewTeamCalendar(profile);
  const today = hkToday();
  const monday = mondayOf(isDate(sp.week) ? sp.week : today);
  let owner = profile;
  let people: Profile[] = [];
  if (teamCalendar) {
    const result = await supabase.from("profiles").select("id, email, full_name, role, active").order("full_name");
    if (result.error) return <><h1>日曆</h1><p className="error" role="alert">暫時未能讀取同事名單，請重新載入。</p></>;
    people = (result.data ?? []) as Profile[];
    if (!people.some((person) => person.id === profile.id)) people = [profile, ...people];
    if (sp.agent && sp.agent !== "me") {
      const selected = people.find((person) => person.id === sp.agent);
      if (!selected) return <><h1>日曆</h1><p className="error" role="alert">搵唔到呢位同事，請重新選擇。</p><CalendarFilters people={people} ownerId={profile.id} monday={monday} /></>;
      owner = selected;
    }
  }
  const readOnly = owner.id !== profile.id;
  const [days, cards, allTasks] = await Promise.all([loadWeek(supabase, owner.id, monday),listClientCards(supabase,owner.id),loadFollowups(supabase,owner.id)]);
  const wk = isoWeek(monday);
  const q = (w: string) => `/activity?week=${w}${teamCalendar ? `&agent=${owner.id}` : ""}`;

  return (
    <>
      {readOnly && (
        <p className="small">
          <Link href={`/admin/agents/${owner.id}`}>← {displayName(owner)} 嘅看板</Link>
        </p>
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>{readOnly ? `${displayName(owner)} 嘅日曆` : "日曆"}</h1>
      </div>
      {teamCalendar && <CalendarFilters people={people} ownerId={owner.id} monday={monday} />}
      {readOnly && <p className="notice">主管查看模式：同事日曆唯讀，由負責同事更新。</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <Link className="btn btn-sm" href={q(addDays(monday, -7))}>
          ← 上週
        </Link>
        <b>
          {wk.year} 第 {wk.week} 週（{shortDate(monday)}–{shortDate(addDays(monday, 6))}）
        </b>
        <Link className="btn btn-sm" href={q(addDays(monday, 7))}>
          下週 →
        </Link>
        {monday !== mondayOf(today) && (
          <Link className="btn btn-sm" href={q(mondayOf(today))}>
            返今週
          </Link>
        )}
      </div>
      <ActivityWeek key={`${owner.id}:${monday}`} days={days} today={today} readOnly={readOnly} clients={cards.map(c=>({id:c.id,name:c.info.name}))} initialClient={cards.some(c=>c.id===sp.client) ? sp.client : ""} tasks={allTasks.filter(isCalendarTask)} ownerQuery={readOnly ? `&agent=${owner.id}` : ""} />
    </>
  );
}
