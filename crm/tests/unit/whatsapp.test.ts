import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describeDraft, hasContent, matchClient, type Draft } from "@/lib/whatsapp/apply";
import { FIELD_IDS, extractionSchema, type Extraction } from "@/lib/whatsapp/schema";
import { verifySignature } from "@/lib/whatsapp/send";

const clients = [
  { id: "1", name: "陳大文" },
  { id: "2", name: "李小美" },
  { id: "3", name: "陳大明" },
];

const empty: Extraction = {
  client: { name: "", age: "", gender: "", occupation: "", marital: "" },
  fields: [],
  checks: [],
  stage: "",
  season: "",
  activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 },
  appointment: { slot: "", text: "" },
  date: "2026-10-10",
  summary: "",
};

describe("配對客戶", () => {
  it("全名完全相同", () => expect(matchClient("陳大文", clients)).toEqual({ mode: "existing", id: "1", name: "陳大文" }));
  it("忽略空格", () => expect(matchClient(" 李 小美 ", clients)).toMatchObject({ mode: "existing", id: "2" }));
  it("部分相同但多過一個 → 要問", () =>
    expect(matchClient("陳大", clients)).toEqual({ mode: "ambiguous", name: "陳大", candidates: ["陳大文", "陳大明"] }));
  it("名入面包含舊客名", () => expect(matchClient("李小美小姐", clients)).toMatchObject({ mode: "existing", id: "2" }));
  it("搵唔到 → 新客", () => expect(matchClient("何志強", clients)).toMatchObject({ mode: "new", name: "何志強" }));
  it("冇名", () => expect(matchClient("  ", clients)).toEqual({ mode: "none" }));
});

describe("草稿", () => {
  it("舊活動計分唔再視為可以儲存嘅內容", () => {
    expect(hasContent({ texts: ["hi"], today: "2026-10-10", extraction: empty, target: { mode: "none" } })).toBe(false);
    expect(
      hasContent({ texts: ["x"], today: "2026-10-10", extraction: { ...empty, activity: { ...empty.activity, r: 1 } }, target: { mode: "none" } }),
    ).toBe(false);
  });

  it("確認訊息列出會寫入嘅內容", () => {
    const d: Draft = {
      texts: ["..."],
      today: "2026-10-10",
      target: { mode: "new", id: "x", name: "何志強" },
      extraction: {
        ...empty,
        client: { name: "何志強", age: "40", gender: "M", occupation: "工程師", marital: "married" },
        fields: [{ field: "form_rr.family", text: "・已婚，兩個女" }],
        checks: ["rr_like_trust"],
        activity: { ...empty.activity, a: 1, rr: 1 },
        appointment: { slot: "lunch", text: "何生 中環" },
      },
    };
    const msg = describeDraft(d);
    expect(msg).toContain("何志強（🆕 新客，40歲・男・工程師・已婚）");
    expect(msg).toContain("【了解客戶・1) 家庭】\n・已婚，兩個女");
    expect(msg).toContain("✅ 簽單條件：客人喜歡和信任你");
    expect(msg).toContain("📅 日曆（10/10）");
    expect(msg).not.toContain("A+1");
    expect(msg).not.toContain("RR+1");
    expect(msg).toContain("🍽 午餐 appointment：何生 中環");
    expect(msg).toContain("回覆「確認」儲存");
  });
});

describe("AI 輸出驗證", () => {
  it("接受正確格式、拒絕亂嚟嘅欄位", () => {
    expect(extractionSchema.parse(empty)).toEqual(empty);
    expect(() => extractionSchema.parse({ ...empty, fields: [{ field: "form_rr.hack", text: "x" }] })).toThrow();
    expect(() => extractionSchema.parse({ ...empty, checks: ["is_admin"] })).toThrow();
    expect(() => extractionSchema.parse({ ...empty, activity: { ...empty.activity, a: 500 } })).toThrow();
  });
  it("欄位清單包括所有表格欄位", () => {
    expect(FIELD_IDS).toContain("form_rr.family");
    expect(FIELD_IDS).toContain("form_nr2.budget_text");
    expect(FIELD_IDS).toContain("form_fna.income");
    expect(new Set(FIELD_IDS).size).toBe(FIELD_IDS.length);
  });
});

describe("WhatsApp 簽名", () => {
  const body = '{"x":1}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
  it("正確簽名先接受", () => {
    expect(verifySignature(body, sig, "secret")).toBe(true);
    expect(verifySignature(body + " ", sig, "secret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "secret")).toBe(false);
    expect(verifySignature(body, sig, undefined)).toBe(false);
  });
});
