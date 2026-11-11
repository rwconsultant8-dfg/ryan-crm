import type {MeetingSummary} from "./meeting";
import type { Task } from "./planner";

export type ClientOption = { id: string; name: string };
export type ContactEvent = { id: string; at: string; day?: string; text: string; kind: "contact" | "note"; meeting?:MeetingSummary; source?:string };
export const isOpenTask = (t: Pick<Task, "status">) => t.status === "planned" || t.status === "blocked";
export const taskOrder = (t: Pick<Task, "day" | "time">) => `${t.day}T${t.time || "23:59"}`;
export const overdueTask = (t: Pick<Task, "day" | "time" | "status">, today: string, time = "00:00") =>
  isOpenTask(t) && (t.day < today || (t.day === today && Boolean(t.time) && t.time! < time));
export function nextClientTask(tasks: Task[], clientId: string) {
  return tasks.filter(t => t.client_id === clientId && isOpenTask(t)).sort((a,b) => taskOrder(a).localeCompare(taskOrder(b)))[0];
}
export function missionProgress(tasks: Task[]) {
  const active = tasks.filter(t => t.status !== "cancelled");
  const done = active.filter(t => t.status === "done").length;
  return { done, total: active.length, percent: active.length ? Math.round(done / active.length * 100) : 0 };
}
export function readContactHistory(raw: string | undefined): ContactEvent[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((e): e is ContactEvent => Boolean(e && typeof e.id === "string" && typeof e.at === "string" && typeof e.text === "string" && (e.day === undefined || typeof e.day === "string") && (e.kind === "contact" || e.kind === "note")));
  } catch { return []; }
}
export const validTime = (value: string) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const appointmentClientKey = (slot: string) => `${slot}_client_id`;
export const appointmentTimeKey = (slot: string) => `${slot}_time`;
export type CalendarEntry = { day: string; slot: string; label: string; text: string; client_id: string; time: string };
export function calendarEntries(days: { day: string; appts: Record<string,string> }[], slots: readonly {key:string;label:string}[]): CalendarEntry[] {
  return days.flatMap(d => slots.flatMap(s => {
    const text = d.appts[s.key] || "", client_id = d.appts[appointmentClientKey(s.key)] || "";
    return text || client_id ? [{ day:d.day, slot:s.key, label:s.label, text, client_id, time:d.appts[appointmentTimeKey(s.key)] || "" }] : [];
  }));
}

/** 看板、客戶頁及缺少下一步提示，共用任務與日曆嘅最早安排。 */
export function nextClientStep(tasks:Task[], appointments:CalendarEntry[], clientId:string, today:string) {
  const task = nextClientTask(tasks,clientId);
  const candidates:{day:string;time?:string;plan:string}[] = task ? [{day:task.day,time:task.time,plan:task.plan}] : [];
  for (const a of appointments) if (a.client_id===clientId && a.day>=today) candidates.push({day:a.day,time:a.time,plan:a.text || `${a.label} appointment`});
  return candidates.sort((a,b)=>`${a.day}T${a.time || "23:59"}`.localeCompare(`${b.day}T${b.time || "23:59"}`))[0] || null;
}
