import Link from "next/link";
import ActivityWeek from "@/components/ActivityWeek";
import { requireUser, displayName } from "@/lib/auth";
import {isCalendarTask} from "@/lib/calendar-tasks";
import { loadFollowups } from "@/lib/planner-data";
import { listClientCards } from "@/lib/data";
import { loadWeek } from "@/lib/activity-data";
import { resolveViewedOwner } from "@/lib/viewing";
import { addDays, hkToday, isDate, isoWeek, mondayOf, shortDate } from "@/lib/weeks";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ week?: string; agent?: string; client?: string }> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const { owner, readOnly } = await resolveViewedOwner(supabase, profile, sp.agent);

  const today = hkToday();
  const monday = mondayOf(isDate(sp.week) ? sp.week : today);
  const [days, cards, allTasks] = await Promise.all([loadWeek(supabase, owner.id, monday),listClientCards(supabase,owner.id),loadFollowups(supabase,owner.id)]);
  const wk = isoWeek(monday);
  const q = (w: string) => `/activity?week=${w}${readOnly ? `&agent=${owner.id}` : ""}`;

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
      {readOnly && <p className="notice">👁 唯讀</p>}
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
