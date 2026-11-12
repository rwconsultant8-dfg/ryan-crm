// WARS 每週活動分（取代《WARS 2026》）

export type ActivityKey = "r" | "n" | "a" | "rr" | "nr" | "pc";

export const ACTIVITIES: { key: ActivityKey; code: string; label: string; points: number; perfect: number }[] = [
  { key: "r", code: "R", label: "Morning Routine／Training／Event", points: 1, perfect: 5 },
  { key: "n", code: "N", label: "認識新人脈落紅簿", points: 5, perfect: 10 },
  { key: "a", code: "A", label: "見 Appointment", points: 2, perfect: 30 },
  { key: "rr", code: "RR", label: "建立信任關係／Ask Referral", points: 2, perfect: 20 },
  { key: "nr", code: "NR", label: "討論財策需要／開口要求", points: 4, perfect: 20 },
  { key: "pc", code: "PC", label: "講解計劃書／成交", points: 5, perfect: 15 },
];

export const ACTIVITY_KEYS = ACTIVITIES.map((a) => a.key);
export const PERFECT_TOTAL = ACTIVITIES.reduce((s, a) => s + a.perfect, 0); // 100

export const APPT_SLOTS = [
  { key: "breakfast", label: "上午", time: "06:00–11:59" },
  { key: "lunch", label: "中午", time: "12:00–13:59" },
  { key: "tea", label: "下午", time: "14:00–17:59" },
  { key: "dinner", label: "晚上", time: "18:00–翌日05:59" },
] as const;

export const DAY_PERIODS = { morning: "上午", noon: "中午", afternoon: "下午", evening: "晚上" } as const;
export type DayPeriod = keyof typeof DAY_PERIODS;
const periodSlots = { morning: "breakfast", noon: "lunch", afternoon: "tea", evening: "dinner" } as const;
export const appointmentTimeLabel = (time?:string, period?:string) => time || (period && Object.hasOwn(DAY_PERIODS,period) ? DAY_PERIODS[period as DayPeriod] : "");

export type Counts = Record<ActivityKey, number>;
export const emptyCounts = (): Counts => ({ r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 });

/** 每項分數＝次數 × 每次分數 */
export function pointsByActivity(c: Partial<Counts>): Counts {
  const out = emptyCounts();
  for (const a of ACTIVITIES) out[a.key] = (c[a.key] ?? 0) * a.points;
  return out;
}

export const totalPoints = (c: Partial<Counts>) => Object.values(pointsByActivity(c)).reduce((s, v) => s + v, 0);

export function sumCounts(list: Partial<Counts>[]): Counts {
  const out = emptyCounts();
  for (const c of list) for (const k of ACTIVITY_KEYS) out[k] += c[k] ?? 0;
  return out;
}

/** KPI 顏色：綠 70–100、黃 40–69、紅 0–39 */
export type Kpi = "green" | "yellow" | "red";
export const kpiOf = (total: number): Kpi => (total >= 70 ? "green" : total >= 40 ? "yellow" : "red");
export const KPI_LABEL: Record<Kpi, string> = { green: "綠", yellow: "黃", red: "紅" };

/** Timed task appointments share the calendar grid without duplicating stored records. */
export function appointmentSlot(time?:string, period?:string): typeof APPT_SLOTS[number]["key"] | null {
  if(time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    const hour=Number(time.slice(0,2));
    return hour<6 || hour>=18 ? "dinner" : hour<12 ? "breakfast" : hour<14 ? "lunch" : "tea";
  }
  return period && Object.hasOwn(periodSlots,period) ? periodSlots[period as DayPeriod] : null;
}
