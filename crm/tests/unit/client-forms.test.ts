import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coachingDatabase } from "./helpers/coaching-db";
import { encryptColumn, decryptColumn } from "@/lib/secure";
import { getClientFull, listClientCards } from "@/lib/data";
import { moveStageAction, saveFactFindingAction, saveFormAction, saveMeetingFocusAction, updateInfoAction } from "@/app/(app)/clients/actions";
import ClientEditor, { ClientStageForm, type EditorClient } from "@/components/ClientEditor";
import { factFindingChecklist, pointFormLines } from "@/lib/client-forms";
import { CHECK_KEYS, STAGES, type Checks, type Stage } from "@/lib/stages";
import { applyDraft, type Draft } from "@/lib/whatsapp/apply";
import { extractionSchema } from "@/lib/whatsapp/schema";

const context = vi.hoisted(() => ({ db: null as any, owner: "staff" }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ supabase: context.db, profile: { id: context.owner } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

const forms = (): EditorClient["forms"] => ({ form_rr: {}, form_nr1: {}, form_nr2: {}, form_fna: {}, form_pc: {} });
const render = (phase: Stage, values = forms(), readOnly = false) => renderToStaticMarkup(
  React.createElement(ClientStageForm, { phase, forms: values, readOnly, onChange: vi.fn() }),
);
beforeEach(() => {
  vi.stubGlobal("React", React);
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");
  context.owner = "staff";
});
afterEach(() => vi.unstubAllGlobals());

describe("客戶工作流程", () => {
  it("shows automatic Fact Finding, selectable Needs and Presentation consensus and drill", () => {
    const meeting = render("MEETING"), followup = render("FOLLOWUP"), proposal = render("PROPOSAL");
    expect(meeting.match(/<textarea/g)).toHaveLength(9);
    expect(meeting).toContain("資料 checklist");
    expect(meeting).toContain("見面準備");
    expect(meeting).toContain('id="client-form_nr1-notes"');
    for (const field of ["helped", "point_a", "point_b", "situation", "common_issues", "point_c", "summary"]) {
      expect(meeting).not.toContain(`id="client-form_${["helped", "point_a", "point_b"].includes(field) ? "rr" : "nr1"}-${field}"`);
    }
    expect(meeting).not.toContain("了解客戶");
    expect(followup.match(/<textarea/g)).toHaveLength(1);
    expect(followup).toContain("跟進記錄（自由填寫）");
    expect(followup.match(/type="checkbox"/g)).toHaveLength(8);
    for (const product of ["保障", "財富增值", "人壽保險", "醫療保險", "儲蓄保險"]) expect(followup).toContain(product);
    expect(followup).not.toMatch(/checked=""/);
    expect(proposal.match(/<textarea/g)).toHaveLength(7);
    for (const label of ["目的", "效果", "內容", "共識", "計劃書與客戶嘅關聯", "Drill", "補充記錄（自由填寫）"]) expect(proposal).toContain(label);
    expect(proposal).not.toMatch(/自評|FAB|異議/);
    for (const html of [meeting, followup, proposal]) expect(html).not.toContain("過往記錄");
  });

  it("ticks only populated facts, including approximate age and zero financial values", () => {
    const values = forms(); values.form_rr = { family: "有一名子女", finance: "0", hobbies: "  " };
    const checklist = factFindingChecklist({ name: "Mary", age: "50幾", occupation: "會計", gender: "" }, values);
    expect(checklist.filter((entry) => entry.complete).map((entry) => entry.key)).toEqual(["info.name", "info.age", "info.occupation", "form_rr.family", "form_rr.finance"]);
    const html = renderToStaticMarkup(React.createElement(ClientStageForm, { phase: "MEETING", forms: values, info: { name: "Mary", age: "50幾" }, readOnly: true, onChange: vi.fn() }));
    expect(html.match(/☑️/g)).toHaveLength(4);
    expect(html).toContain("年齡<span class=\"sr-only\">：已有資料");
    expect(html).toContain("性別<span class=\"sr-only\">：未填資料");
  });

  it("exposes all five workflow tabs, including service records, to staff and supervisors", () => {
    const client: EditorClient = { id: "client", stage: "SIGNED", season: "SUMMER", info: { name: "Mary", age: "", occupation: "", gender: "", marital: "" }, checks: Object.fromEntries(CHECK_KEYS.map((key) => [key, false])) as Checks, forms: forms() };
    for (const readOnly of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(ClientEditor, { client, readOnly }));
      expect(html.match(/role="tab"/g)).toHaveLength(5);
      expect(html).toContain('id="client-tab-MEETING" aria-controls="client-tab-panel" aria-selected="true"');
      expect(html).toContain('aria-label="基本資料"');
      for (const stage of STAGES) expect(html).toContain(`id="client-tab-${stage.key}"`);
    }
  });

  it("renders independent Closing and Referral service point lists without invented instructions", () => {
    expect(render("SIGNED")).not.toContain('class="client-point-list"');
    const values = forms(); values.form_pc = { closing_points: "- 提醒客戶核對資料\n・ 約定下一步", referral_points: "1. 問清楚轉介人聯絡方式" };
    const closing = render("SIGNED", values, true), referral = render("ISSUED", values, true);
    expect(closing).toContain("<li>提醒客戶核對資料</li>");
    expect(closing).not.toContain("問清楚轉介人聯絡方式");
    expect(referral).toContain("<li>問清楚轉介人聯絡方式</li>");
    expect(referral).not.toContain("提醒客戶核對資料");
    for (const html of [closing, referral]) expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(pointFormLines("\n- 第一項\r\n2. 第二項\n" )).toEqual(["第一項", "第二項"]);
  });

  it("reads product ticks from stored values and does not infer other needs", () => {
    const values = forms(); values.form_nr2 = { need_life: "true", need_medical: "true", need_savings: "", notes: "已持有儲蓄保單" };
    const html = render("FOLLOWUP", values, true);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("已持有儲蓄保單");
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(8);
  });

  it("keeps populated historical fields collapsed and makes a supervisor's fields read-only", () => {
    const values = forms();
    values.form_nr2 = { values: "舊價值觀記錄", notes: "最新跟進" };
    values.form_fna = { income: "50000" };
    const html = render("FOLLOWUP", values, true);
    expect(html).toContain('<details class="history">');
    expect(html).toContain("過往記錄（2）");
    expect(html).toContain("舊價值觀記錄");
    expect(html).toContain("50000");
    expect(html).toContain("最新跟進</textarea>");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html.match(/<textarea/g)).toHaveLength(1);
    values.form_rr = { helped: "舊協助記錄", point_a: "舊現況", point_b: "舊目標" };
    values.form_nr1 = { situation: "舊見面準備", notes: "下次帶同客戶要求嘅資料" };
    const meeting = render("MEETING", values, true);
    expect(meeting).toContain("過往記錄（4）");
    for (const value of ["舊協助記錄", "舊現況", "舊目標", "舊見面準備"]) expect(meeting).toContain(value);
    expect(meeting).toContain("下次帶同客戶要求嘅資料</textarea>");
    expect(factFindingChecklist({}, values).some((item) => ["form_rr.helped", "form_rr.point_a", "form_rr.point_b"].includes(item.key))).toBe(false);
  });
});

describe("簡化表單儲存", () => {
  function database() {
    const fake = coachingDatabase({ clients: [{
      id: "client", owner_id: "staff", nr2_budget_set: true,
      updated_at: "2026-11-11T00:00:00.000Z",
      info: encryptColumn("client", "info", {}, { name: "Mary", age: "50幾", occupation: "Telegram 最新職業", contact_history: "保留 Telegram 歷史" }),
      form_nr2: encryptColumn("client", "form_nr2", {}, { values: "原有價值觀", budget_text: "3000" }),
      form_pc: encryptColumn("client", "form_pc", {}, { r_purpose: "原有目的", value_before: "原有方案記錄" }),
    }] });
    context.db = fake.db;
    return fake;
  }
  it("allows the client owner to save and clear meeting focus while preserving history", async () => {
    const fake = database();
    const row = fake.tables.clients[0];
    context.owner = "supervisor";
    expect((await saveMeetingFocusAction("client", "核對文件", null)).ok).toBe(false);
    expect(fake.writes).toHaveLength(0);
    context.owner = "staff";
    expect(await saveMeetingFocusAction("client", "核對文件", null)).toEqual({ ok: true });
    expect((await saveMeetingFocusAction("client", "覆蓋更新", null)).ok).toBe(false);
    expect(decryptColumn("client", "info", row.info)).toMatchObject({
      meeting_focus: JSON.stringify("核對文件"), contact_history: "保留 Telegram 歷史",
    });
    expect(await saveMeetingFocusAction("client", "", "核對文件")).toEqual({ ok: true });
    expect(decryptColumn("client", "info", row.info).meeting_focus).toBe(JSON.stringify(""));
  });

  it("saves Fact Finding, its basic details and checks together without overwriting hidden history", async () => {
    const fake = database();
    const row = fake.tables.clients[0];
    row.form_rr = encryptColumn("client", "form_rr", {}, { point_a: "舊客戶現況" });
    expect(await saveFactFindingAction("client", { age: "約55" }, { form_rr: { family: "新資料" }, form_nr1: { notes: "準備文件" } }, { rr_like_trust: true })).toEqual({ ok: true });
    expect(fake.writes).toHaveLength(1);
    expect(decryptColumn("client", "info", row.info)).toMatchObject({ age: "約55", contact_history: "保留 Telegram 歷史" });
    expect(decryptColumn("client", "form_rr", row.form_rr)).toEqual({ point_a: "舊客戶現況", family: "新資料" });
    expect(decryptColumn("client", "form_nr1", row.form_nr1)).toEqual({ notes: "準備文件" });
    expect(row.rr_like_trust).toBe(true);

    const before = structuredClone(row);
    fake.conflictOnce();
    expect((await saveFactFindingAction("client", { age: "56" }, { form_rr: { family: "另一個版本" } }, {})).ok).toBe(false);
    expect(row).toEqual(before);
  });

  it("reads older Referral stages and notes, then clears a stale stage marker on a move", async () => {
    const fake = database(), row = fake.tables.clients[0];
    row.stage = "SIGNED";
    row.form_pc = encryptColumn("client", "form_pc", row.form_pc, { referral_stage: "true", referral_service_notes: "舊轉介資料", agreement: "舊共識" });
    row.referral_stage = row.form_pc.referral_stage;
    expect((await listClientCards(fake.db))[0].stage).toBe("ISSUED");
    expect(await getClientFull(fake.db, "client")).toMatchObject({ stage: "ISSUED", forms: { form_pc: { referral_points: "舊轉介資料", consensus: "舊共識" } } });
    expect(await moveStageAction("client", "SIGNED")).toEqual({ ok: true });
    expect((await getClientFull(fake.db, "client"))?.stage).toBe("SIGNED");
    expect(await saveFormAction("client", "PC", { consensus: "" }, {})).toEqual({ ok: true });
    const updated = await getClientFull(fake.db, "client");
    expect(updated?.forms.form_pc.consensus).toBeUndefined();
    expect(updated?.forms.form_pc.agreement).toBe("舊共識");
  });

  it("only saves and renders HTTPS proposal links without embedded credentials", async () => {
    const fake = database();
    expect((await saveFormAction("client", "PC", { proposal_url: "javascript:alert(1)" }, {})).ok).toBe(false);
    expect((await saveFormAction("client", "PC", { proposal_url: "https://user:pass@example.test/" }, {})).ok).toBe(false);
    const url = "https://example.test/proposal";
    expect(await saveFormAction("client", "PC", { proposal_url: url }, {})).toEqual({ ok: true });
    expect(render("PROPOSAL", (await getClientFull(fake.db, "client"))!.forms)).toContain(`href="${url}"`);
  });

  it("saves and clears free text without deleting hidden history or resetting old checks", async () => {
    const fake = database();
    expect(await saveFormAction("client", "NR2", { notes: "員工自由填寫\n下一步聯絡客戶" }, {})).toEqual({ ok: true });
    const row = fake.tables.clients[0];
    expect(decryptColumn("client", "form_nr2", row.form_nr2)).toEqual({ values: "原有價值觀", budget_text: "3000", notes: "員工自由填寫\n下一步聯絡客戶" });
    expect(row.nr2_budget_set).toBe(true);
    expect(await saveFormAction("client", "NR2", { notes: "" }, {})).toEqual({ ok: true });
    expect(decryptColumn("client", "form_nr2", row.form_nr2)).toEqual({ values: "原有價值觀", budget_text: "3000" });
    row.form_nr1 = encryptColumn("client", "form_nr1", {}, { situation: "舊準備內容", point_c: "原有概念" });
    expect(await saveFormAction("client", "NR1", { notes: "帶同客戶要求嘅資料" }, {})).toEqual({ ok: true });
    expect(decryptColumn("client", "form_nr1", row.form_nr1)).toEqual({ situation: "舊準備內容", point_c: "原有概念", notes: "帶同客戶要求嘅資料" });
  });
  it("updates purpose, effect, content and free notes while preserving previous proposal detail", async () => {
    const fake = database();
    const values = { r_purpose: "新目的", r_effect: "預期效果", r_content: "方案內容", notes: "其他補充" };
    expect(await saveFormAction("client", "PC", values, {})).toEqual({ ok: true });
    expect(decryptColumn("client", "form_pc", fake.tables.clients[0].form_pc)).toEqual({ ...values, value_before: "原有方案記錄" });
  });
  it("continues to reject changes to another employee's customer", async () => {
    const fake = database();
    context.owner = "supervisor";
    expect((await saveFormAction("client", "NR2", { notes: "不能修改" }, {})).ok).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });

  it("saves and unchecks products without removing Telegram facts or other selections", async () => {
    const fake = database();
    expect(await saveFormAction("client", "NR2", { need_life: "true", need_medical: "true", need_savings: "true" }, {})).toEqual({ ok: true });
    expect(await saveFormAction("client", "NR2", { need_medical: "" }, {})).toEqual({ ok: true });
    expect(decryptColumn("client", "form_nr2", fake.tables.clients[0].form_nr2)).toEqual({ values: "原有價值觀", budget_text: "3000", need_life: "true", need_savings: "true" });
    expect((await saveFormAction("client", "NR2", { need_life: "maybe" }, {})).ok).toBe(false);
  });

  it("preserves service points and all proposal history when another field is saved", async () => {
    const fake = database();
    expect(await saveFormAction("client", "PC", { closing_points: "第一點\n第二點", referral_points: "轉介事項" }, {})).toEqual({ ok: true });
    expect(await saveFormAction("client", "PC", { consensus: "客戶認同方向", client_connection: "對應目標", drill: "練習內容" }, {})).toEqual({ ok: true });
    expect(decryptColumn("client", "form_pc", fake.tables.clients[0].form_pc)).toMatchObject({ closing_points: "第一點\n第二點", referral_points: "轉介事項", consensus: "客戶認同方向", value_before: "原有方案記錄", r_purpose: "原有目的" });
  });

  it("updates only the edited basic field while preserving newer Telegram facts and history", async () => {
    const fake = database();
    expect(await updateInfoAction("client", { age: "約55" })).toEqual({ ok: true });
    expect(decryptColumn("client", "info", fake.tables.clients[0].info)).toEqual({ name: "Mary", age: "約55", occupation: "Telegram 最新職業", contact_history: "保留 Telegram 歷史" });
  });

  it("refuses a simultaneous update rather than replacing the current encrypted record", async () => {
    const fake = database(), before = structuredClone(fake.tables.clients[0]);
    fake.conflictOnce();
    const result = await saveFormAction("client", "PC", { closing_points: "新內容" }, {});
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("未有覆蓋新內容") });
    expect(fake.tables.clients[0]).toEqual(before);
    expect(fake.writes[0].conditions).toContainEqual(["updated_at", "2026-11-11T00:00:00.000Z"]);
    fake.conflictOnce();
    expect((await updateInfoAction("client", { age: "56" })).ok).toBe(false);
    expect(fake.tables.clients[0]).toEqual(before);
  });

  it("accepts explicit Telegram product changes and appends service points without deleting old content", async () => {
    const fake = database();
    await saveFormAction("client", "NR2", { need_life: "true", need_medical: "true" }, {});
    await saveFormAction("client", "PC", { closing_points: "原有事項", referral_points: "原有轉介內容" }, {});
    const extraction = extractionSchema.parse({ client: { name: "Mary", age: "", gender: "", occupation: "", marital: "" }, fields: [
      { field: "form_nr2.need_life", text: "false" }, { field: "form_nr2.need_savings", text: "true" },
      { field: "form_nr2.need_other", text: "冇明確選擇" }, { field: "form_pc.closing_points", text: "新增事項" },
    ], checks: [], stage: "", season: "", activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 }, appointment: { slot: "", text: "" }, summary: "更新 Mary", date: "2026-11-11" });
    const draft: Draft = { channel: "telegram", texts: ["Mary 更新"], today: "2026-11-11", target: { mode: "existing", id: "client", name: "Mary" }, extraction };
    await applyDraft(fake.db, "staff", draft);
    const row = fake.tables.clients[0];
    expect(decryptColumn("client", "form_nr2", row.form_nr2)).toMatchObject({ need_medical: "true", need_savings: "true", values: "原有價值觀" });
    expect(decryptColumn("client", "form_nr2", row.form_nr2)).not.toHaveProperty("need_life");
    expect(decryptColumn("client", "form_nr2", row.form_nr2)).not.toHaveProperty("need_other");
    expect(decryptColumn("client", "form_pc", row.form_pc)).toMatchObject({ referral_points: "原有轉介內容", closing_points: expect.stringContaining("原有事項") });
    expect(decryptColumn("client", "form_pc", row.form_pc).closing_points).toContain("新增事項");
  });
});
