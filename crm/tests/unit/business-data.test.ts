import { describe, expect, it } from "vitest";
import { loadTeamMonth } from "@/lib/business-data";

describe("團隊生意資料", () => {
  function database(fail = false) {
    const calls: { table: string; month: string; from: number }[] = [];
    const rows = Array.from({ length: 1001 }, (_, index) => ({ owner_id: index === 1000 ? "b" : "a", afyp: 1, revenue: 2, commission: 3 }));
    const db = { from: (table: string) => {
      let month = "";
      const q = { select: () => q, order: () => q, eq: (_key: string, value: string) => { month = value; return q; }, range: async (from: number, to: number) => {
        calls.push({ table, month, from });
        return { data: table === "business_cases" ? rows.slice(from, to + 1) : [{ owner_id: "c", cases: 2, afyp: 3000, revenue: 0, commission: 0 }], error: fail && table === "monthly_targets" ? { message: "unavailable" } : null };
      } };
      return q;
    } };
    return { db: db as never, calls };
  }
  it("reads every page and retains colleagues with targets but no cases", async () => {
    const { db, calls } = database();
    const team = await loadTeamMonth(db, "2026-11");
    expect(team.get("a")?.done).toEqual({ cases: 1000, afyp: 1000, revenue: 2000, commission: 3000 });
    expect(team.get("b")?.done.cases).toBe(1);
    expect(team.get("c")?.done.cases).toBe(0);
    expect(team.get("c")?.target.afyp).toBe(3000);
    expect(calls.filter((call) => call.table === "business_cases").map((call) => call.from)).toEqual([0, 500, 1000]);
    expect(calls.every((call) => call.month === "2026-11-01")).toBe(true);
  });
  it("fails rather than presenting an unreadable target as zero", async () => {
    await expect(loadTeamMonth(database(true).db, "2026-11")).rejects.toThrow("unavailable");
  });
});
