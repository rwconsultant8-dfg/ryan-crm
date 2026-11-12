import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTarget, sortBusinessRows, sumTargets } from "@/lib/business";

const context = vi.hoisted(() => ({ role: "admin", calls: [] as string[], month: vi.fn(), team: vi.fn(), profileError: false }));
const people = [
  { id: "ryan", full_name: "Ryan", email: "ryan@test", role: "admin", active: true },
  { id: "chelsea", full_name: "Chelsea", email: "chelsea@test", role: "agent", active: true },
  { id: "momo", full_name: "Momo", email: "momo@test", role: "agent", active: true },
  { id: "old", full_name: "舊同事", email: "old@test", role: "agent", active: false },
];
vi.mock("@/lib/auth", () => ({
  displayName: (person: { full_name: string }) => person.full_name,
  requireUser: async () => ({ profile: { ...people[context.role === "admin" ? 0 : 1], role: context.role }, supabase: {
    from: (table: string) => {
      context.calls.push(table);
      let id = "";
      const q = {
        select: () => q, order: () => q, not: () => q,
        eq: (key: string, value: string) => { if (key === "id") id = value; return q; },
        maybeSingle: async () => ({ data: people.find((person) => person.id === id), error: null }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "profiles" ? people : [], error: context.profileError ? { message: "unavailable" } : null }).then(resolve),
      };
      return q;
    },
  } }),
}));
vi.mock("@/lib/business-data", () => ({ loadMonth: context.month, loadTeamMonth: context.team }));
vi.mock("@/lib/data", () => ({ listClientCards: async () => [] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement("a", { href, ...props }, children) }));
import BusinessPage from "@/app/(app)/business/page";

const target = (afyp: number, cases: number) => ({ ...emptyTarget(), afyp, cases });
beforeEach(() => {
  vi.stubGlobal("React", React);
  context.role = "admin";
  context.calls = [];
  context.profileError = false;
  context.month.mockReset().mockResolvedValue({ cases: [], target: emptyTarget() });
  context.team.mockReset().mockResolvedValue(new Map([
    ["chelsea", { done: { cases: 2, afyp: 20000, revenue: 15000, commission: 6000 }, target: target(40000, 3) }],
    ["momo", { done: { cases: 1, afyp: 30000, revenue: 18000, commission: 7000 }, target: target(30000, 2) }],
    ["old", { done: { cases: 1, afyp: 1000, revenue: 500, commission: 100 }, target: emptyTarget() }],
  ]));
});
afterEach(() => vi.unstubAllGlobals());
const page = async (params: { month?: string; agent?: string; sort?: string } = {}) => renderToStaticMarkup(await BusinessPage({ searchParams: Promise.resolve({ month: "2026-11", ...params }) }));

describe("主管生意總覽與同事隔離", () => {
  it("defaults to an accurate team overview including zero-business and inactive colleagues", async () => {
    const html = await page();
    expect(html).toContain("團隊生意總覽");
    expect(html).toContain('data-testid="team-cases">4 單');
    expect(html).toContain('data-testid="team-afyp">$51,000');
    for (const name of ["Ryan", "Chelsea", "Momo", "舊同事", "已停用", "50%", "100%", "查看同事", "排序"]) expect(html).toContain(name);
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
    expect([...body.matchAll(/data-owner="([^"]+)"/g)].map((match) => match[1])).toEqual(["momo", "chelsea", "old", "ryan"]);
    expect(html).toContain('/business?month=2026-11&amp;agent=chelsea&amp;sort=afyp_desc');
    expect(context.month).not.toHaveBeenCalled();
  });
  it("sorts colleagues by case count and retains the selected month in navigation", async () => {
    const html = await page({ sort: "cases_desc" });
    expect([...html.matchAll(/data-owner="([^"]+)"/g)][0][1]).toBe("chelsea");
    expect(html).toContain("month=2026-12&amp;sort=cases_desc");
  });
  it("shows an individual colleague's sorted details read-only", async () => {
    const row = (id: string, name: string, afyp: number) => ({ id, client_id: null, client_name: name, product: "產品", note: "", afyp, revenue: 0, commission: 0 });
    context.month.mockResolvedValue({ cases: [row("a", "客甲", 1000), row("b", "客乙", 5000)], target: emptyTarget() });
    const html = await page({ agent: "chelsea" });
    expect(context.month).toHaveBeenCalledWith(expect.anything(), "chelsea", "2026-11");
    expect(html).toContain("Chelsea 嘅每月生意");
    expect(html).toContain("唯讀");
    expect(html.indexOf('value="客乙"')).toBeLessThan(html.indexOf('value="客甲"'));
    expect(html).not.toContain("＋ 新增一單");
    expect(html).not.toContain("儲存目標");
    expect(html).toContain("month=2026-12&amp;agent=chelsea&amp;sort=afyp_desc");
  });
  it("ignores another owner in a colleague's URL without loading team or profile data", async () => {
    context.role = "agent";
    const html = await page({ agent: "momo" });
    expect(context.team).not.toHaveBeenCalled();
    expect(context.calls).not.toContain("profiles");
    expect(context.month).toHaveBeenCalledWith(expect.anything(), "chelsea", "2026-11");
    expect(html).toContain("＋ 新增一單");
    expect(html).not.toContain("查看同事");
    expect(html).not.toContain("Momo");
  });
  it("shows an error instead of an empty overview when team data is unavailable", async () => {
    context.team.mockRejectedValue(new Error("unavailable"));
    const html = await page();
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-testid="team-cases"');
  });
});

describe("生意排序及加總", () => {
  it("adds case totals rather than counting colleagues and rounds monetary totals", () => {
    expect(sumTargets([{ cases: 3, afyp: 0.1, revenue: 2, commission: 3 }, { cases: 2, afyp: 0.2, revenue: 4, commission: 5 }])).toEqual({ cases: 5, afyp: 0.3, revenue: 6, commission: 8 });
  });
  it("supports numeric ascending, descending and name order without mutating source rows", () => {
    const rows = [{ name: "B", afyp: 20, revenue: 3, commission: 1 }, { name: "A", afyp: 3, revenue: 50, commission: 5 }];
    for (const sort of ["afyp_asc", "revenue_desc", "commission_desc", "name_asc"] as const) expect(sortBusinessRows(rows, sort)[0].name).toBe("A");
    expect(sortBusinessRows(rows, "afyp_desc")[0].name).toBe("B");
    expect(rows[0].name).toBe("B");
  });
});
