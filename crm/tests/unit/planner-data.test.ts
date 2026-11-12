import { afterEach, expect, it, vi } from "vitest";
import { loadTasks } from "@/lib/planner-data";
import { coachingDatabase } from "./helpers/coaching-db";

afterEach(() => vi.unstubAllEnvs());

it("loads every page for the requested date and respects an optional owner filter", async () => {
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
  const day = "2026-11-09";
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: `task-${index}`, day, owner_id: index % 2 ? "chelsea" : "kiky", info: {},
  }));
  const db = coachingDatabase({ daily_tasks: [...rows, { ...rows[0], id: "tomorrow", day: "2026-11-10" }] });

  const all = await loadTasks(db.db, day, day);
  expect(all).toHaveLength(501);
  expect(all.at(-1)?.id).toBe("task-500");
  expect(all.every((task) => task.day === day)).toBe(true);

  const one = await loadTasks(db.db, day, day, "chelsea");
  expect(one).toHaveLength(250);
  expect(one.every((task) => task.owner_id === "chelsea")).toBe(true);
});
