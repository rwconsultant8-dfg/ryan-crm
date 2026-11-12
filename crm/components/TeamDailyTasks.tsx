import Link from "next/link";
import { appointmentTimeLabel } from "@/lib/activity";
import { displayName, type Profile } from "@/lib/auth";
import { taskOrder } from "@/lib/followups";
import { CATEGORIES, STATUSES, type Task } from "@/lib/planner";
import { addDays, mondayOf, WEEKDAY_LABELS, weekDays } from "@/lib/weeks";

type Person = Pick<Profile, "id" | "email" | "full_name" | "active">;
type TeamDay = { people: Person[]; tasks: Task[] };

function TaskCard({ task }: { task: Task }) {
  const badge = task.status === "done" ? "badge-green" : task.status === "blocked" ? "badge-yellow" : "badge-grey";
  return (
    <article className={`planner-task task-${task.status}`}>
      <div className="row">
        <strong>{task.name || "未命名任務"}</strong>
        <span className="spacer" />
        <span className={`badge ${badge}`}>{STATUSES[task.status]}</span>
      </div>
      <span className="small muted">{appointmentTimeLabel(task.time, task.period) || "時間待定"} · {CATEGORIES[task.category]}</span>
      <p>{task.plan}</p>
      {task.result && <p className="small"><b>結果：</b>{task.result}</p>}
      {task.client_id && <Link className="small" href={`/clients/${task.client_id}`}>打開客戶檔案 ↗</Link>}
    </article>
  );
}

export default function TeamDailyTasks({ data, day, today, viewerId }: {
  data: TeamDay | null;
  day: string;
  today: string;
  viewerId: string;
}) {
  const url = (date: string) => `/today?view=team&day=${date}`;
  const tasksByOwner = new Map<string, Task[]>();
  for (const task of data?.tasks ?? []) {
    if (task.owner_id === viewerId || task.day !== day) continue;
    const tasks = tasksByOwner.get(task.owner_id) ?? [];
    tasks.push(task);
    tasksByOwner.set(task.owner_id, tasks);
  }
  const people = new Map((data?.people ?? [])
    .filter((person) => person.id !== viewerId && (person.active || tasksByOwner.has(person.id)))
    .map((person) => [person.id, displayName(person) + (person.active ? "" : "（已停用）")]));
  for (const id of tasksByOwner.keys()) {
    if (!people.has(id)) people.set(id, "同事");
  }

  return (
    <>
      <div className="section-heading">
        <h1>團隊每日任務</h1>
        <span className="badge badge-grey">主管唯讀</span>
      </div>
      <nav className="week-toolbar" aria-label="切換團隊任務星期">
        <Link className="btn btn-sm" href={url(addDays(day, -7))}>← 上週</Link>
        <Link className="btn btn-sm" href={url(today)}>返今日</Link>
        <Link className="btn btn-sm" href={url(addDays(day, 7))}>下週 →</Link>
      </nav>
      <nav className="planner-days" aria-label="選擇團隊任務日期">
        {weekDays(mondayOf(day)).map((date, index) => (
          <Link key={date} className={`btn${day === date ? " btn-primary" : ""}`} aria-current={day === date ? "date" : undefined} href={url(date)}>
            {WEEKDAY_LABELS[index]}<small>{date.slice(5)}{date === today ? " · 今日" : ""}</small>
          </Link>
        ))}
      </nav>
      <form key={day} action="/today" method="get" className="week-toolbar">
        <input type="hidden" name="view" value="team" />
        <label className="row"><span>跳到日期</span><input type="date" name="day" defaultValue={day} required /></label>
        <button type="submit" className="btn btn-sm">查看</button>
      </form>

      {data === null ? <p className="error" role="alert">暫時未能讀取團隊任務，請稍後重新載入。</p> :
        people.size === 0 ? <p className="card muted">未有其他同事嘅任務。</p> :
        <div className="staff-task-list">
          {[...people].map(([id, name]) => {
            const tasks = (tasksByOwner.get(id) ?? []).sort((a, b) => taskOrder(a).localeCompare(taskOrder(b)));
            return (
              <section className="card" key={id}>
                <div className="row">
                  <h2>{name}</h2>
                  <span className="badge badge-grey">{tasks.length} 個任務</span>
                  <span className="spacer" />
                  <Link className="btn btn-sm" href={`/today?agent=${encodeURIComponent(id)}&day=${day}`}>查看個人任務</Link>
                </div>
                {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} />) :
                  <p className="muted">呢日未有任務。</p>}
              </section>
            );
          })}
        </div>
      }
    </>
  );
}
