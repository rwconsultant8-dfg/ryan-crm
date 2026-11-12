import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { briefAuthorized, briefDay, briefDeliveryKey, renderMorningBrief } from "@/lib/telegram/morning-brief";

describe("Ryan Telegram brief", () => {
  it("requires a dedicated valid bearer token", () => {
    const token = "a".repeat(64);
    const hash = createHash("sha256").update(token).digest("hex");
    expect(briefAuthorized(`Bearer ${token}`, hash)).toBe(true);
    expect(briefAuthorized(`Bearer ${"b".repeat(64)}`, hash)).toBe(false);
    expect(briefAuthorized(`Bearer ${hash}`, hash)).toBe(false);
    expect(briefAuthorized(`Bearer ${token}`, "")).toBe(false);
  });

  it("starts at 9:30 in Hong Kong, bounds late runs and marks a test with the Hong Kong date", () => {
    expect(briefDay(Date.parse("2026-11-12T01:29:59Z"), false)).toBeNull();
    expect(briefDay(Date.parse("2026-11-12T01:30:00Z"), false)).toBe("2026-11-12");
    expect(briefDay(Date.parse("2026-11-12T02:30:00Z"), false)).toBeNull();
    expect(briefDay(Date.parse("2026-11-12T23:30:00Z"), true)).toBe("2026-11-13");
  });

  it("deduplicates an intentional retest separately from the automatic daily brief", () => {
    const day = "2026-11-12";
    const id = "a".repeat(32);
    const key = briefDeliveryKey("test", day, [id]);
    expect(key).toBe(briefDeliveryKey("test", "2026-11-13", [id]));
    expect(key).not.toBe(briefDeliveryKey("test", day, []));
    expect(key).not.toBe(briefDeliveryKey("test", day, ["b".repeat(32)]));
    expect(briefDeliveryKey("daily", day, [])).toBe(`zest-ryan-brief-v1:daily:${day}`);
    expect(briefDeliveryKey("daily", day, [id])).toBeNull();
    expect(briefDeliveryKey("check", day, [id])).toBeNull();
    expect(briefDeliveryKey("test", day, [id, id])).toBeNull();
    expect(briefDeliveryKey("test", day, ["invalid"])).toBeNull();
  });

  it("reports each active colleague’s times and update statuses without appointment or update text", () => {
    const result = renderMorningBrief("2026-11-12", new Map([["a", "Ada"], ["b", "Ben"]]), [
      { owner: "a", time: "16:00", clientName: "private client" },
      { owner: "a", time: "上午" },
      { owner: "a", time: "16:00" },
      { owner: "inactive", time: "09:11" },
    ] as Parameters<typeof renderMorningBrief>[2], [
      { owner: "b", status: "applied", sourceText: "private details" },
      { owner: "b", status: "pending" },
      { owner: "inactive", status: "pending" },
    ] as Parameters<typeof renderMorningBrief>[3], true);
    expect(result).toContain("（試發）");
    expect(result).toContain("Ada：上午、16:00");
    expect(result).toContain("Ben：1 項已入 CRM、1 項待同事確認");
    expect(result).not.toMatch(/private|09:11/);
  });
});
