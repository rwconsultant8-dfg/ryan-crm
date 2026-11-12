"use client";
import Link from "next/link";
import {appointmentTimeLabel} from "@/lib/activity";
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, PLAN_STAGES, STATUSES, type Task } from "@/lib/planner";
import { missionProgress, overdueTask, taskOrder, type ClientOption, type CalendarEntry } from "@/lib/followups";
import { WEEKDAY_LABELS, weekDays } from "@/lib/weeks";
import { createTask, updateTask } from "@/app/(app)/today/actions";

function TaskRow({ task, readOnly, onComplete }: { task: Task; readOnly: boolean; onComplete: () => void }) {
  const [status, setStatus] = useState(task.status);
  const [result, setResult] = useState(task.result || "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return <article className={`planner-task task-${task.status}`}>
    <div className="row"><span className="quest-dot" aria-hidden="true">{task.status === "done" ? "✓" : "◇"}</span><strong>{task.name}</strong><span className="spacer"/><span className={`badge ${task.status === "done" ? "badge-green" : task.status === "blocked" ? "badge-yellow" : "badge-grey"}`}>{STATUSES[task.status]}</span></div>
    <span className="small muted">{appointmentTimeLabel(task.time,task.period) || "時間待定"} · {PLAN_STAGES[task.stage]}</span>
    <p>{task.plan}</p>
    {task.client_id && <Link className="small" href={`/clients/${task.client_id}`}>打開客戶檔案 ↗</Link>}
    {readOnly ? <p className="small">{task.result || "未有結果記錄"}</p> : <details><summary>記低結果／完成任務</summary>
      <form onSubmit={e => { e.preventDefault(); start(async () => {
        try { const r = await updateTask({ id: task.id, updated_at: task.updated_at, status, result }); setError(r.error); if (!r.error) { if (status === "done" && task.status !== "done") onComplete(); router.refresh(); } }
        catch { setError("儲存失敗，請重試。"); }
      }); }}>
        <label className="field"><span>狀態</span><select disabled={pending} value={status} onChange={e => setStatus(e.target.value as Task["status"])}>{Object.entries(STATUSES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>實際結果／下一步</span><textarea disabled={pending} maxLength={2000} value={result} onChange={e => setResult(e.target.value)} placeholder="傾過乜？下次需要準備乜？" /></label>
        <button className="btn btn-primary" disabled={pending}>{pending ? "儲存中…" : "儲存結果"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form></details>}
  </article>;
}

export default function DailyPlanner({ tasks, focusTasks, appointments = [], clients = [], missingClients = [], initialClient = "", initialDay, ownerQuery = "", monday, today, readOnly, simple = false, showIntro=true }: {
  tasks: Task[]; focusTasks: Task[]; appointments?: CalendarEntry[]; clients?: ClientOption[]; missingClients?: ClientOption[];
  initialClient?: string; initialDay?: string; ownerQuery?: string; monday: string; today: string; readOnly: boolean; simple?: boolean; showIntro?:boolean;
}) {
  const days = weekDays(monday);
  const [day, setDay] = useState(initialDay && days.includes(initialDay) ? initialDay : days.includes(today) ? today : monday);
  const [clientId, setClientId] = useState(initialClient);
  const [filter, setFilter] = useState<"day" | "overdue" | "missing">("day");
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const progress = missionProgress(tasks);
  const overdue = focusTasks.filter(t => overdueTask(t,today));
  const todayAppts = appointments.filter(a => a.day === today);
  const notifyComplete = () => { setCelebrate(true); window.setTimeout(() => setCelebrate(false), 4000); };
  const showToday = () => {
    if (!days.includes(today)) { router.push(`/today${ownerQuery ? `?${ownerQuery.slice(1)}` : ""}`); return; }
    setFilter("day"); setDay(today);
  };
  const filtered = (filter === "overdue" ? overdue : tasks.filter(t => t.day === day)).slice().sort((a,b) => taskOrder(a).localeCompare(taskOrder(b)));
  return <>
    {!simple && showIntro && <><section className="quest-hero">
      <div className="quest-hero-copy"><span className="eyebrow">YOUR RELATIONSHIP QUEST</span><h2>今日，推進一小步。</h2><p>每次聯絡，都令關係行近一點。揀一個任務，開始今日嘅進度。</p>{!readOnly && <a className="btn btn-primary" href="#new-plan">＋ 安排下一步</a>}</div>
      <div className="quest-ring" style={{ "--quest-progress": `${progress.percent}%` } as CSSProperties}><div><strong>{progress.percent}<small>%</small></strong><span>本週任務完成</span><b>{progress.done} / {progress.total}</b></div></div>
      <div className="quest-stars" aria-hidden="true">✧</div>
    </section></>}
    {simple ? <div className="staff-focus" aria-label="今日跟進"><button className={`btn ${filter === "day" ? "btn-primary" : ""}`} aria-pressed={filter === "day"} onClick={showToday}>待辦 {focusTasks.filter(t=>t.day===today && (t.status==="planned"||t.status==="blocked")).length}</button><button className={`btn ${filter === "overdue" ? "btn-primary" : ""}`} aria-pressed={filter === "overdue"} onClick={()=>setFilter("overdue")}>逾期 {overdue.length}</button><button className={`btn ${filter === "missing" ? "btn-primary" : ""}`} aria-pressed={filter === "missing"} onClick={()=>setFilter("missing")}>未安排 {missingClients.length}</button>{!readOnly && <a className="btn" href="#new-plan">＋ 新增安排</a>}</div> : <div className="focus-grid" aria-label="跟進焦點">
      <Link className="focus-tile" href={`/activity${ownerQuery ? `?${ownerQuery.slice(1)}` : ""}`}><span>今日 appointment</span><strong>{todayAppts.length + focusTasks.filter(t=>t.day===today && t.category==="appointment" && t.status!=="cancelled").length}</strong><small>打開日程，從容出發 ↗</small></Link>
      <button className={`focus-tile ${filter === "day" ? "selected" : ""}`} onClick={showToday} aria-pressed={filter === "day"}><span>今日待辦</span><strong>{focusTasks.filter(t=>t.day===today && (t.status==="planned" || t.status==="blocked")).length}</strong><small>揀一個任務，開始推進 →</small></button>
      <button className={`focus-tile attention ${filter === "overdue" ? "selected" : ""}`} onClick={() => setFilter("overdue")} aria-pressed={filter === "overdue"}><span>需要跟進</span><strong>{overdue.length}</strong><small>逾期任務，逐件處理 →</small></button>
      <button className={`focus-tile ${filter === "missing" ? "selected" : ""}`} onClick={() => setFilter("missing")} aria-pressed={filter === "missing"}><span>未安排下一步</span><strong>{missingClients.length}</strong><small>為每段關係留低下一站 →</small></button>
    </div>}
    {!simple && showIntro && <div className="milestone-row"><span className="eyebrow">本週里程碑</span>{[1,5,10].map(n=><span key={n} className={`milestone ${progress.done>=n ? "unlocked" : ""}`}>{progress.done>=n ? "✦" : "◇"} 完成 {n} 個任務</span>)}</div>}
    {celebrate && !simple && <div className="quest-success" role="status"><span aria-hidden="true">✦</span><strong>任務完成！</strong><span>又推進咗一步。記得為客戶安排下一次跟進。</span></div>}
    {todayAppts.length > 0 && <section className="today-agenda"><h2>今日行程</h2><div className="agenda-strip">{todayAppts.map(a=><article key={`${a.day}:${a.slot}`}><span className="small muted">{a.time || a.label}</span><strong>{clients.find(c=>c.id===a.client_id)?.name || a.text || a.label}</strong><p>{a.text}</p>{a.client_id && <Link href={`/clients/${a.client_id}`}>客戶檔案 ↗</Link>}</article>)}</div></section>}
    {!readOnly && <details className="planner-add card" id="new-plan" open={Boolean(initialClient)}><summary>＋ 安排下一步</summary><form onSubmit={e => {
      e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form));
      start(async () => { try { const r = await createTask(values); setError(r.error); if (!r.error) { form.reset(); setClientId(""); router.refresh(); } } catch { setError("儲存失敗，請重試。"); } });
    }}>
      <div className="grid-2"><label className="field"><span>日期</span><input name="day" type="date" defaultValue={day} required disabled={pending}/></label><label className="field"><span>時間（可選）</span><input name="time" type="time" disabled={pending}/></label>
      <label className="field"><span>連結客戶</span><select name="client_id" value={clientId} onChange={e=>setClientId(e.target.value)} disabled={pending}><option value="">其他對象／暫不連結</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name || "未命名客戶"}</option>)}</select></label>
      <label className="field"><span>對象</span>{clientId ? <input name="name" key={clientId} value={clients.find(c=>c.id===clientId)?.name || "未命名客戶"} readOnly/> : <input name="name" type="text" placeholder="例如 Mary" maxLength={120} required disabled={pending}/>}</label>
      <label className="field"><span>工作類別</span><select name="category" disabled={pending}>{Object.entries(CATEGORIES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>今次跟進重點</span><select name="stage" disabled={pending}>{Object.entries(PLAN_STAGES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <label className="field"><span>下一步做乜</span><input name="plan" type="text" placeholder="例如準備建議書，再約時間講解" maxLength={1000} required disabled={pending}/></label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "儲存中…" : "加入任務"}</button>{error && <p role="alert" className="error">{error}</p>}
    </form></details>}
    {filter === "missing" ? <section><h2>為關係安排下一站</h2><div className="missing-grid">{missingClients.length ? missingClients.map(c=><article className="card" key={c.id}><strong>{c.name}</strong><p className="muted">未有待辦跟進或未來 appointment。</p><Link className="btn" href={`/clients/${c.id}`}>打開客戶檔案 →</Link></article>) : <p className="notice">每位跟進中客戶都已有下一步安排。</p>}</div></section> : <>
      <div className="section-heading"><div>{!simple && <span className="eyebrow">MISSION BOARD</span>}<h2>{filter==="overdue" ? "先處理需要跟進嘅任務" : "每日任務"}</h2></div><Link className="btn btn-sm" href={`/activity?week=${monday}${ownerQuery}`}>打開日曆 ↗</Link></div>
      {filter==="day" && <div className="planner-days" role="group" aria-label="選擇日期">{days.map((d,i) => <button key={d} className={`btn ${day === d ? "btn-primary" : ""}`} aria-pressed={day === d} onClick={() => setDay(d)}>{WEEKDAY_LABELS[i]}<small>{d.slice(5)}{d === today ? " · 今日" : ""}</small></button>)}</div>}
      {simple ? <div className="staff-task-list">{filtered.length ? filtered.map(t=><TaskRow key={`${t.id}:${t.updated_at}`} task={t} readOnly={readOnly} onComplete={notifyComplete}/>) : <p className="card muted">{filter==="overdue" ? "冇逾期待辦。" : "呢日暫時未有待辦。"}</p>}</div> : <>{filtered.length===0&&<p className="planner-empty-mobile card muted">呢日暫時未有待辦。</p>}<div className="planner-columns">{Object.entries(CATEGORIES).map(([key,label],i) => {
        const items = filtered.filter(t => t.category === key);
        return <section key={key} data-empty={items.length===0}><h2><span className="lane-number">0{i+1}</span>{label}<span className="badge badge-grey">{items.length}</span></h2>{items.length ? items.map(t => <TaskRow key={`${t.id}:${t.updated_at}`} task={t} readOnly={readOnly} onComplete={notifyComplete}/>) : <p className="planner-empty">暫時未有任務</p>}</section>;
      })}</div></>}
    </>}
  </>;
}
