import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coachingDatabase } from "./helpers/coaching-db";
import { encryptColumn, decryptColumn } from "@/lib/secure";
import { matchesCustomerType, customerTypeLabel } from "@/lib/customer-types";
import { updateInfoAction } from "@/app/(app)/clients/actions";
import { applyDraft, type Draft } from "@/lib/whatsapp/apply";
import InfoFields from "@/components/InfoFields";

const context = vi.hoisted(() => ({ db: null as any, id: "staff-a" }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: context.db, profile: { id: context.id } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const info = { name: "Mary", age: "50幾", gender: "", occupation: "會計", marital: "" };
beforeEach(() => { vi.stubGlobal("React", React); process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64"); context.id = "staff-a"; });
afterEach(() => vi.unstubAllGlobals());
function database() {
  const fake = coachingDatabase({ clients: [{ id: "client", owner_id: "staff-a", info: encryptColumn("client", "info", {}, { ...info, customer_type: "new", contact_history: "[]" }) }] });
  context.db = fake.db; return fake;
}
describe("新客戶／現有客戶分類", () => {
  it("shows the classification in basic details with an unclassified option for old records", () => {
    const html = renderToStaticMarkup(React.createElement(InfoFields, { value: { ...info, customer_type: "existing" }, onChange: vi.fn() }));
    expect(html).toContain('name="customer_type"'); expect(html).toContain("新客戶"); expect(html).toContain("未分類");
    expect(html).toContain('<option value="existing" selected="">現有客戶</option>');
  });
  it("saves the employee's choice and preserves hidden customer history", async () => {
    const fake = database();
    expect(await updateInfoAction("client", { ...info, customer_type: "existing" })).toEqual({ ok: true });
    expect(decryptColumn("client", "info", fake.tables.clients[0].info)).toMatchObject({ name: "Mary", age: "50幾", occupation: "會計", customer_type: "existing", contact_history: "[]" });
    expect(await updateInfoAction("client", info)).toEqual({ ok: true });
    expect(decryptColumn("client", "info", fake.tables.clients[0].info).customer_type).toBe("existing");
  });
  it("rejects invalid categories and changes by another account", async () => {
    const fake = database();
    expect((await updateInfoAction("client", { ...info, customer_type: "SIGNED" })).ok).toBe(false);
    context.id = "another";
    expect((await updateInfoAction("client", { ...info, customer_type: "existing" })).ok).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
  it("filters customer category independently from pipeline stage and leaves legacy records unclassified", () => {
    const rows = [{ name: "新客", stage: "SIGNED", type: "new" }, { name: "舊客", stage: "MEETING", type: "existing" }, { name: "原有記錄", stage: "ISSUED", type: undefined }];
    expect(rows.filter((row) => matchesCustomerType(row.type, "existing")).map((row) => row.name)).toEqual(["舊客"]);
    expect(rows.filter((row) => matchesCustomerType(row.type, "new")).map((row) => row.name)).toEqual(["新客"]);
    expect(rows.filter((row) => matchesCustomerType(row.type, "unclassified")).map((row) => row.name)).toEqual(["原有記錄"]);
    expect(customerTypeLabel(undefined)).toBe("未分類");
  });
  it("lets an explicit Telegram update change the category without changing the owner's other facts", async () => {
    const fake = database();
    const draft: Draft = { channel: "telegram", texts: ["Mary係現有客戶"], today: "2026-11-09", target: { mode: "existing", id: "client", name: "Mary" }, extraction: {
      client: { name: "Mary", age: "", gender: "", occupation: "", marital: "", customer_type: "existing" }, fields: [], checks: [], stage: "", season: "", activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 }, appointment: { slot: "", text: "" }, date: "2026-11-09", summary: "分類", tasks: [],
    } };
    await applyDraft(fake.db, "staff-a", draft);
    expect(decryptColumn("client", "info", fake.tables.clients[0].info)).toMatchObject({ age: "50幾", occupation: "會計", customer_type: "existing" });
  });
});
