import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyTarget, monthStart, totals, type CaseRow, type Target } from "./business";
import { decryptColumn } from "./secure";

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await page(from, from + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function loadMonth(supabase: SupabaseClient, ownerId: string, ym: string) {
  const [rows, { data: t, error: targetError }] = await Promise.all([
    readAll((from, to) => supabase
      .from("business_cases")
      .select("id, client_id, data, afyp, revenue, commission, created_at")
      .eq("owner_id", ownerId)
      .eq("month", monthStart(ym))
      .order("created_at").order("id").range(from, to)),
    supabase.from("monthly_targets").select("cases, afyp, revenue, commission").eq("owner_id", ownerId).eq("month", monthStart(ym)).maybeSingle(),
  ]);
  if (targetError) throw new Error(targetError.message);
  const cases: CaseRow[] = (rows ?? []).map((r) => {
    const d = decryptColumn(r.id, "data", r.data);
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: d.client_name ?? "",
      product: d.product ?? "",
      note: d.note ?? "",
      afyp: Number(r.afyp),
      revenue: Number(r.revenue),
      commission: Number(r.commission),
    };
  });
  const target: Target = t
    ? { cases: Number(t.cases), afyp: Number(t.afyp), revenue: Number(t.revenue), commission: Number(t.commission) }
    : emptyTarget();
  return { cases, target };
}

/** 全組某月：每人 { done, target } */
export async function loadTeamMonth(supabase: SupabaseClient, ym: string) {
  const [rows, targets] = await Promise.all([
    readAll((from, to) => supabase.from("business_cases").select("owner_id, afyp, revenue, commission").eq("month", monthStart(ym)).order("id").range(from, to)),
    readAll((from, to) => supabase.from("monthly_targets").select("owner_id, cases, afyp, revenue, commission").eq("month", monthStart(ym)).order("id").range(from, to)),
  ]);
  const out = new Map<string, { done: Target; target: Target }>();
  const byOwner = new Map<string, { afyp: number; revenue: number; commission: number }[]>();
  for (const r of rows ?? []) {
    const list = byOwner.get(r.owner_id) ?? [];
    list.push({ afyp: Number(r.afyp), revenue: Number(r.revenue), commission: Number(r.commission) });
    byOwner.set(r.owner_id, list);
  }
  for (const [id, list] of byOwner) out.set(id, { done: totals(list), target: emptyTarget() });
  for (const t of targets ?? []) {
    const cur = out.get(t.owner_id) ?? { done: emptyTarget(), target: emptyTarget() };
    cur.target = { cases: Number(t.cases), afyp: Number(t.afyp), revenue: Number(t.revenue), commission: Number(t.commission) };
    out.set(t.owner_id, cur);
  }
  return out;
}
