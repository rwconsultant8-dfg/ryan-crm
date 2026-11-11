import { describe, expect, it } from "vitest";
import { describeChanges, fieldLabel } from "@/lib/audit";
import { CHECK_KEYS, CLIENT_FORMS, FORMS, PIPELINE_STAGES, formFieldKeys, isReady, missingChecks, toPipelineStage, type Checks } from "@/lib/stages";

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
      { stage: "RR", label: "客人與你有交情／共同經歷" },
      { stage: "NR2", label: "確立客人預算金額" },
    ]);
  });
});

describe("客戶流程", () => {
  it("顯示指定嘅五個階段同三個階段表格", () => {
    expect(PIPELINE_STAGES.map((stage) => stage.label)).toEqual([
      "Fact Finding", "Needs", "Presentation", "Closing", "Referral",
    ]);
    expect(CLIENT_FORMS.map((form) => form.stage)).toEqual(["RR", "NR2", "PC"]);
  });

  it("保留舊客戶喺流程入面，只有標明 Referral 嘅已簽客先顯示喺 Referral", () => {
    expect(toPipelineStage("NR1", false)).toBe("NR2");
    expect(toPipelineStage("FNA", false)).toBe("NR2");
    expect(toPipelineStage("ISSUED", false)).toBe("SIGNED");
    expect(toPipelineStage("SIGNED", false)).toBe("SIGNED");
    expect(toPipelineStage("SIGNED", true)).toBe("REFERRAL");
    expect(toPipelineStage("PC", true)).toBe("PC");
  });
});

describe("表格定義", () => {
  it("五個階段表格，欄位 key 唔重複", () => {
    expect(FORMS.map((f) => f.stage)).toEqual(["RR", "NR1", "NR2", "FNA", "PC"]);
    for (const f of FORMS) {
      const keys = formFieldKeys(f);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("審計顯示", () => {
  it("欄位名轉中文", () => {
    expect(fieldLabel("form_rr.family")).toBe("RR・1) 家庭");
    expect(fieldLabel("appts.lunch")).toBe("午餐約會");
    expect(fieldLabel("focus.plan")).toBe("宣告 PDCA 焦點");
    expect(fieldLabel("nr")).toBe("NR 次數");
    expect(fieldLabel("form_nr2.budget_text")).toBe("NR2・金額");
    expect(fieldLabel("info.name")).toBe("基本資料・姓名");
    expect(fieldLabel("nr2_budget_set")).toBe("NR2 條件・確立客人預算金額");
  });
  it("階段變更顯示前後", () => {
    expect(describeChanges({ stage: { old: "RR", new: "SIGNED" } }, "UPDATE")).toEqual([{ label: "階段", detail: "Fact Finding → Closing" }]);
  });
});
