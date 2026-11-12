import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/auth";

const state = vi.hoisted(() => ({ role: "admin", profileError: false, tables: [] as string[], week: vi.fn(), cards: vi.fn(), tasks: vi.fn() }));
const people: Profile[] = [
  { id: "ryan", email: "ryan@test", full_name: "Ryan", role: "admin", active: true },
  { id: "momo", email: "momo@test", full_name: "Momo", role: "agent", active: true },
  { id: "chelsea", email: "chelsea@test", full_name: "Chelsea", role: "agent", active: true },
  { id: "old", email: "old@test", full_name: "舊同事", role: "agent", active: false },
];
vi.mock("@/lib/auth", () => ({
  displayName: (person: Profile) => person.full_name || person.email,
  requireUser: async () => ({
    profile: state.role === "admin" ? people[0] : people[1],
    supabase: { from: (table: string) => {
      state.tables.push(table);
      return { select: () => ({ order: async () => ({ data: people, error: state.profileError ? { message: "unavailable" } : null }) }) };
    } },
  }),
}));
vi.mock("@/lib/activity-data", () => ({ loadWeek: state.week }));
vi.mock("@/lib/data", () => ({ listClientCards: state.cards }));
vi.mock("@/lib/planner-data", () => ({ loadFollowups: state.tasks }));
vi.mock("@/app/(app)/activity/actions", () => ({ saveActivityWeekAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import ActivityPage from "@/app/(app)/activity/page";

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.role = "admin"; state.profileError = false; state.tables = [];
  state.week.mockReset().mockImplementation(async (_db, owner, monday) => [{ day: monday, appts: { breakfast: `${owner} 原有約會` } }]);
  state.cards.mockReset().mockResolvedValue([]);
  state.tasks.mockReset().mockImplementation(async (_db, owner) => [{ id: "appointment", owner_id: owner, day: "2026-11-09", category: "appointment", stage: "", name: `${owner} 客戶`, plan: "Telegram 見客安排", time: "15:00", status: "planned", result: "", updated_at: "" }]);
});
afterEach(() => vi.unstubAllGlobals());
const page = async (query: { agent?: string; week?: string } = {}) => renderToStaticMarkup(await ActivityPage({ searchParams: Promise.resolve({ week: "2026-11-09", ...query }) }));

describe("主管查看同事日曆", () => {
  it("lets Ryan choose any colleague and reads only that colleague's appointments, customers and tasks", async () => {
    const html = await page({ agent: "chelsea" });
    for (const person of people) expect(html).toContain(`value="${person.id}"`);
    expect(html).toContain('name="week" value="2026-11-09"');
    expect(html).toContain("Chelsea 嘅日曆");
    expect(html).toContain('aria-label="選擇同事日曆"');
    expect(html).toContain('href="/activity?week=2026-11-09&amp;agent=momo"');
    expect(html).toContain("chelsea 原有約會");
    expect(html).toContain("chelsea 客戶");
    expect(html).toContain("Telegram 見客安排");
    expect(html).toContain("同事日曆唯讀");
    expect(html).not.toContain("儲存日曆");
    expect(html).not.toContain("編輯安排");
    expect(html).toContain("week=2026-11-16&amp;agent=chelsea");
    for (const load of [state.week, state.cards, state.tasks]) expect(load).toHaveBeenCalledWith(expect.anything(), "chelsea", ...(load === state.week ? ["2026-11-09"] : []));
  });
  it("keeps Ryan's own calendar editable and preserves the chosen week for another colleague", async () => {
    const own = await page();
    expect(state.week).toHaveBeenCalledWith(expect.anything(), "ryan", "2026-11-09");
    expect(own).toContain("儲存日曆");
    expect(own).not.toContain("同事日曆唯讀");
    const momo = await page({ agent: "momo", week: "2026-11-18" });
    expect(momo).toContain("Momo 嘅日曆");
    expect(state.week).toHaveBeenLastCalledWith(expect.anything(), "momo", "2026-11-16");
    expect(momo).toContain('name="week" value="2026-11-16"');
  });
  it("ignores another owner in an ordinary employee's URL and does not expose the team list", async () => {
    state.role = "agent";
    const html = await page({ agent: "chelsea" });
    expect(state.tables).not.toContain("profiles");
    for (const load of [state.week, state.cards, state.tasks]) expect(load).toHaveBeenCalledWith(expect.anything(), "momo", ...(load === state.week ? ["2026-11-09"] : []));
    expect(html).not.toContain("查看同事日曆");
    expect(html).not.toContain("Chelsea");
    expect(html).toContain("儲存日曆");
  });
  it("reports an unknown colleague without quietly displaying somebody else's calendar", async () => {
    expect(await page({ agent: "unknown" })).toContain("搵唔到呢位同事");
    expect(state.week).not.toHaveBeenCalled();
  });
  it("reports profile lookup failures rather than presenting a misleading empty team list", async () => {
    state.profileError = true;
    const html = await page();
    expect(html).toContain('role="alert"');
    expect(html).toContain("未能讀取同事名單");
    expect(state.week).not.toHaveBeenCalled();
  });
});
