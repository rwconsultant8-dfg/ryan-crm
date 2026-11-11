// 功能四：每月生意表（取代《四季紅簿 2026》頂部嘅生意表）

export type Money = { afyp: number; revenue: number; commission: number };
export type Target = Money & { cases: number };
export type CaseRow = Money & {
  id: string;
  client_id: string | null;
  client_name: string;
  product: string;
  note: string;
};

export const MONEY_KEYS = ["afyp", "revenue", "commission"] as const;
export const MONEY_LABELS: Record<(typeof MONEY_KEYS)[number], string> = { afyp: "AFYP", revenue: "Revenue", commission: "佣金" };

export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const monthStart = (ym: string) => `${ym}-01`;
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const monthLabel = (ym: string) => `${ym.slice(0, 4)} 年 ${Number(ym.slice(5))} 月`;

export const emptyTarget = (): Target => ({ cases: 0, afyp: 0, revenue: 0, commission: 0 });

export function totals(rows: Money[]): Target {
  const t = emptyTarget();
  for (const r of rows) {
    t.cases += 1;
    for (const k of MONEY_KEYS) t[k] += Number(r[k]) || 0;
  }
  for (const k of MONEY_KEYS) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

/** 完成度（%），冇目標就 null */
export const pct = (done: number, target: number) => (target > 0 ? Math.round((done / target) * 100) : null);

export const hkd = (n: number) => `$${n.toLocaleString("en-HK", { maximumFractionDigits: 2 })}`;

export const BUSINESS_SORTS = [
  { value: "afyp_desc", label: "AFYP：高至低" },
  { value: "afyp_asc", label: "AFYP：低至高" },
  { value: "revenue_desc", label: "Revenue：高至低" },
  { value: "commission_desc", label: "佣金：高至低" },
  { value: "cases_desc", label: "Case 數：多至少" },
  { value: "name_asc", label: "名稱" },
] as const;
export type BusinessSort = (typeof BUSINESS_SORTS)[number]["value"];
export const businessSort = (value: unknown): BusinessSort =>
  BUSINESS_SORTS.find((option) => option.value === value)?.value ?? "afyp_desc";

export function sortBusinessRows<T extends Money & { name: string; cases?: number }>(rows: T[], sort: BusinessSort): T[] {
  return [...rows].sort((a, b) => {
    const byName = () => a.name.localeCompare(b.name, "zh-HK");
    if (sort === "name_asc") return byName();
    if (sort === "cases_desc") return (b.cases ?? 0) - (a.cases ?? 0) || byName();
    const key = sort === "revenue_desc" ? "revenue" : sort === "commission_desc" ? "commission" : "afyp";
    return (sort === "afyp_asc" ? a[key] - b[key] : b[key] - a[key]) || byName();
  });
}

export function sumTargets(rows: Target[]): Target {
  const sum = emptyTarget();
  for (const row of rows) {
    sum.cases += row.cases;
    for (const key of MONEY_KEYS) sum[key] += row[key];
  }
  for (const key of MONEY_KEYS) sum[key] = Math.round(sum[key] * 100) / 100;
  return sum;
}

/** 「12,000」「1.2萬」「$3,000」→ 數字；唔識讀就 null */
export function parseAmount(v: string): number | null {
  const s = v.replace(/[,\s$HK]/gi, "");
  if (s === "") return 0;
  const wan = /^(\d+(\.\d+)?)萬$/.exec(s);
  if (wan) return Math.round(Number(wan[1]) * 10000 * 100) / 100;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 1e10 ? n : null;
}
