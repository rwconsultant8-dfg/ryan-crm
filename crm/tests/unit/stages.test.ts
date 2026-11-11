import { describe, expect, it } from "vitest";
import { describeChanges, fieldLabel } from "@/lib/audit";
import { CHECK_KEYS, FORMS, fnaSummary, formFieldKeys, isReady, missingChecks, type Checks } from "@/lib/stages";

const all = (v: boolean) => Object.fromEntries(CHECK_KEYS.map((k) => [k, v])) as Checks;

describe("簽單條件", () => {
  it("8 格全剔先具備", () => {
    expect(isReady(all(true))).toBe(true);
    expect(isReady(all(false))).toBe(false);
    expect(missingChecks(all(false))).toHaveLength(8);
  });

  it("列出仲差邊幾格", () => {
    const c = { ...all(true), rr_relationship: false, nr2_budget_set: false };
    expect(missingChecks(c)).toEqual([
      { stage: "MEETING", label: "客人與你有交情／共同經歷" },
      { stage: "FOLLOWUP", label: "確立客人預算金額" },
    ]);
  });
});

describe("財務分析", () => {
  it("現金流＝收入－支出，淨資產＝資產－負債", () => {
    expect(fnaSummary({ income: "50,000", expense: "32000", assets: "1000000", liabilities: "1200000" })).toEqual({
      cashflow: 18000,
      netWorth: -200000,
    });
  });
  it("未填就唔計", () => {
    expect(fnaSummary({ income: "50000" })).toEqual({ cashflow: null, netWorth: null });
  });
});

describe("表格定義", () => {
  it("保留歷史表格資料，按三個新進度整理", () => {
    expect(FORMS.map((f) => f.phase)).toEqual(["MEETING", "MEETING", "FOLLOWUP", "FOLLOWUP", "PROPOSAL"]);
    for (const f of FORMS) {
      const keys = formFieldKeys(f);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("審計顯示", () => {
  it("欄位名轉中文", () => {
    expect(fieldLabel("form_rr.family")).toBe("了解客戶・1) 家庭");
    expect(fieldLabel("appts.lunch")).toBe("中午 appointment");
    expect(fieldLabel("focus.plan")).toBe("宣告 PDCA 焦點");
    expect(fieldLabel("nr")).toBe("討論財策需要／開口要求次數");
    expect(fieldLabel("form_nr2.budget_text")).toBe("客戶需要・金額");
    expect(fieldLabel("info.name")).toBe("基本資料・姓名");
    expect(fieldLabel("nr2_budget_set")).toBe("簽單條件・確立客人預算金額");
  });
  it("階段變更顯示前後", () => {
    expect(describeChanges({ stage: { old: "RR", new: "SIGNED" } }, "UPDATE")).toEqual([{ label: "階段", detail: "Fact Finding → Closing" }]);
  });
});
