// 準客戶卡嘅階段、表格欄位、簽單條件定義（取代《Prospect Check List》）

export type Stage = "RR" | "NR1" | "NR2" | "FNA" | "PC" | "SIGNED" | "ISSUED";
export type PipelineStage = "RR" | "NR2" | "PC" | "SIGNED" | "REFERRAL";
export type FormStage = "RR" | "NR1" | "NR2" | "FNA" | "PC";
export type FormColumn = "form_rr" | "form_nr1" | "form_nr2" | "form_fna" | "form_pc";

export const STAGES: { key: Stage; label: string; short: string }[] = [
  { key: "RR", label: "Fact Finding", short: "Fact Finding" },
  { key: "NR1", label: "NR1（開口）", short: "NR1" },
  { key: "NR2", label: "Needs（保障和財富增值）", short: "Needs" },
  { key: "FNA", label: "FNA 財務分析", short: "FNA" },
  { key: "PC", label: "Presentation → 共識", short: "Presentation" },
  { key: "SIGNED", label: "Closing", short: "Closing" },
  { key: "ISSUED", label: "已出單", short: "已出單" },
];

export const STAGE_KEYS = STAGES.map((s) => s.key);
export const stageLabel = (s: Stage) => STAGES.find((x) => x.key === s)?.short ?? s;
export const PIPELINE_STAGES = [
  { key: "RR", label: "Fact Finding" },
  { key: "NR2", label: "Needs" },
  { key: "PC", label: "Presentation" },
  { key: "SIGNED", label: "Closing" },
  { key: "REFERRAL", label: "Referral" },
] as const satisfies ReadonlyArray<{ key: PipelineStage; label: string }>;

export const isPipelineStage = (value: string): value is PipelineStage =>
  PIPELINE_STAGES.some(({ key }) => key === value);

export const isClosedStage = (stage: PipelineStage) => stage === "SIGNED" || stage === "REFERRAL";

// Referral uses the signed storage stage and an encrypted flag in form_pc.
export const REFERRAL_STAGE_KEY = "referral_stage";

export function toPipelineStage(stage: Stage, referral: boolean): PipelineStage {
  if (stage === "NR1" || stage === "FNA") return "NR2";
  if (stage === "ISSUED") return "SIGNED";
  if (stage === "SIGNED" && referral) return "REFERRAL";
  return stage;
}

export type Field = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "rating" | "checkbox" | "url" | "notes";
  hint?: string;
};

export const FOLLOW_UPS = [
  { key: "closing", label: "Closing" },
  { key: "referral_service", label: "Referral" },
] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number]["key"];

export type Section = { title?: string; note?: string; followUp?: FollowUp; fields: Field[] };

export type CheckKey =
  | "rr_like_trust"
  | "rr_stable_income"
  | "rr_relationship"
  | "rr_understand_goal"
  | "nr2_need_confirmed"
  | "nr2_plan_previewed"
  | "nr2_budget_set"
  | "nr2_next_meeting";

export type Check = { key: CheckKey; label: string; fill?: Field };

/** 見客3寶（紙本頁頂） */
export const MEETING_TIPS = "見客3寶：① 笑 ② 讚 ③ 同步";

export type FormDef = {
  stage: FormStage;
  column: FormColumn;
  title: string;
  timing: string;
  tips?: string[]; // 紙本上嘅提示（＊開頭嗰啲）
  sections: Section[];
  checks?: { title: string; items: Check[] };
};

export const RR_CHECKS: Check[] = [
  { key: "rr_like_trust", label: "客人喜歡和信任你" },
  { key: "rr_stable_income", label: "客人有穩定收入或淨資產" },
  { key: "rr_relationship", label: "客人與你有交情／共同經歷" },
  { key: "rr_understand_goal", label: "了解到客人的現況與目標" },
];

export const NR2_CHECKS: Check[] = [
  { key: "nr2_need_confirmed", label: "確認客人的需要", fill: { key: "need_text", label: "需要" } },
  { key: "nr2_plan_previewed", label: "預演計劃相關內容", fill: { key: "product_text", label: "產品" } },
  { key: "nr2_budget_set", label: "確立客人預算金額", fill: { key: "budget_text", label: "金額" } },
  { key: "nr2_next_meeting", label: "確定下次會面時間", fill: { key: "next_meeting_date", label: "日期", type: "date" } },
];

export const ALL_CHECKS: Check[] = [...RR_CHECKS, ...NR2_CHECKS];
export const CHECK_KEYS: CheckKey[] = ALL_CHECKS.map((c) => c.key);

export const FORMS: FormDef[] = [
  {
    stage: "RR",
    column: "form_rr",
    title: "Fact Finding",
    timing: "多方面了解客人（事後紀錄）",
    tips: ["狀態決定環境，環境孕育內容", "建立信任目的：鑒定問題", "發掘痛點：A 點 → B 點"],
    sections: [
      {
        fields: [
          { key: "family", label: "1) 家庭", type: "textarea" },
          { key: "work", label: "2) 工作", type: "textarea" },
          { key: "hobbies", label: "3) 娛樂及興趣", type: "textarea" },
          { key: "finance", label: "4) 財務情況", type: "textarea" },
          { key: "personality", label: "5) 性格及人生目標", type: "textarea" },
          { key: "helped", label: "6) 幫助過對方什麼（人情世故）", type: "textarea" },
          { key: "knowledge", label: "7) 已有理財知識及觀念", type: "textarea" },
          { key: "existing", label: "8) 進行中的理財配置", type: "textarea" },
          { key: "needs", label: "9) 鑑定需要", type: "textarea" },
        ],
      },
      {
        title: "發掘痛點：A 點 → B 點",
        fields: [
          { key: "point_a", label: "A 點（現況）", type: "textarea" },
          { key: "point_b", label: "B 點（目標）", type: "textarea" },
        ],
      },
    ],
    checks: { title: "在 RR 的過程中，了解客人有否以下條件", items: RR_CHECKS },
  },
  {
    stage: "NR1",
    column: "form_nr1",
    title: "NR1 開口",
    timing: "介入點的準備（事前準備）",
    tips: ["創造需要，引發醒覺", "C 點概念建立"],
    sections: [
      {
        fields: [
          { key: "situation", label: "客人的現況、處境、想法、感受和方向", type: "textarea" },
          { key: "common_issues", label: "普遍同類客人會面對的問題和挑戰", type: "textarea" },
          { key: "point_c", label: "客人需要明白的概念／知識／故事（C 點）", type: "textarea" },
          { key: "summary", label: "總結客人的痛點，並表達自己能為對方創造的價值", type: "textarea" },
        ],
      },
    ],
  },
  {
    stage: "NR2",
    column: "form_nr2",
    title: "Needs（保障和財富增值）",
    timing: "根據和客人的深入討論所得出以下問題的結果（事後紀錄）",
    tips: [
      "透過發問、回應、總結，確立需要的價值／建立強烈的購買原因",
      "確立並一致需要 · Fact & Feeling 理財焦點 · 善用發問的力量",
      "Fact Finding 了解人生價值觀（AB 點），Needs 確認客人嘅理財目標同購買原因",
    ],
    sections: [
      {
        fields: [
          { key: "values", label: "了解對客人來說重要的價值觀", type: "textarea" },
          { key: "vision", label: "了解客人人生的願景和目的", type: "textarea" },
          { key: "risks", label: "了解客人實現人生願景過程中會遇見的風險和障礙", type: "textarea" },
          { key: "outcome", label: "了解到客人具體想達致的效果及如何面對風險", type: "textarea" },
        ],
      },
      {
        title: "保障",
        fields: [
          { key: "product_life", label: "人壽保險", type: "checkbox" },
          { key: "product_medical", label: "醫療保險", type: "checkbox" },
        ],
      },
      {
        title: "財富增值",
        fields: [{ key: "product_savings", label: "儲蓄保險", type: "checkbox" }],
      },
      {
        title: "總結客人需要並配置產品",
        note: "配置總結方程式：重申願景 ＋ 面對的阻礙 ＋ 想要的效果 ＝ 產品設計概念 ＋ 一分鐘產品簡介",
        fields: [
          { key: "f_vision", label: "重申願景", type: "textarea" },
          { key: "f_obstacles", label: "面對的阻礙", type: "textarea" },
          { key: "f_effect", label: "想要的效果", type: "textarea" },
          { key: "f_design", label: "產品設計概念", type: "textarea" },
          { key: "f_pitch", label: "一分鐘產品簡介", type: "textarea" },
        ],
      },
    ],
    checks: { title: "Appointment 完結前，確認以下 4 項條件", items: NR2_CHECKS },
  },
  {
    stage: "FNA",
    column: "form_fna",
    title: "FNA 財務分析",
    timing: "金額以港幣（每月）計",
    sections: [
      {
        fields: [
          { key: "income", label: "收入（每月 HK$）", type: "number" },
          { key: "income_note", label: "收入明細", type: "textarea" },
          { key: "expense", label: "支出（每月 HK$）", type: "number" },
          { key: "expense_note", label: "支出明細", type: "textarea" },
          { key: "assets", label: "資產（HK$）", type: "number" },
          { key: "assets_note", label: "資產明細", type: "textarea" },
          { key: "liabilities", label: "負債（HK$）", type: "number" },
          { key: "liabilities_note", label: "負債明細", type: "textarea" },
        ],
      },
    ],
  },
  {
    stage: "PC",
    column: "form_pc",
    title: "Presentation → 共識",
    timing: "事前準備：填寫好以下會面流程準備，會面時按計劃執行",
    sections: [
      {
        title: "客戶計劃書與共識",
        fields: [
          { key: "proposal_url", label: "計劃書連結（HTTPS）", type: "url" },
          { key: "agreement", label: "與客戶達成的共識", type: "textarea" },
        ],
      },
      {
        title: "1. 重申上次會面已一致的配置總結方程式",
        note: "＊澄清有沒有新的想法，如有需重新確認 Needs",
        fields: [
          { key: "r_purpose", label: "目的", type: "textarea" },
          { key: "r_effect", label: "效果", type: "textarea" },
          { key: "r_content", label: "內容", type: "textarea" },
        ],
      },
      {
        title: "2. 帶給客人最大價值的陳述",
        fields: [
          {
            key: "value_before",
            label: "前（概念）：鞏固好客人的正確觀念和合理的期望價值",
            hint: "＊客人為什麼要買？",
            type: "textarea",
          },
          {
            key: "value_middle",
            label: "中（內容）：運用 FAB 技巧，放大方案對客人的價值",
            hint: "＊客人為什麼要選擇這個計劃？",
            type: "textarea",
          },
          {
            key: "value_after",
            label: "後（信心）：設立成交的黃金句語，給予客戶最大的信心和價值",
            hint: "＊客人為什麼要同你買？",
            type: "textarea",
          },
        ],
      },
      {
        title: "3. 客人可能出現的異議",
        note: "＊流程練習 231 技巧",
        fields: [{ key: "objections", label: "異議及回應", type: "textarea" }],
      },
      {
        title: "自評（1–10 分）",
        fields: [
          { key: "conf_concept", label: "概念", type: "rating" },
          { key: "conf_content", label: "內容", type: "rating" },
          { key: "conf_confidence", label: "信心", type: "rating" },
        ],
      },
      ...FOLLOW_UPS.map(({ key }) => ({
        followUp: key,
        fields: [{ key: `${key}_notes`, label: "留意事項", type: "notes" as const }],
      })),
    ],
  },
];

export type ClientFormColumn = Exclude<FormColumn, "form_nr1" | "form_fna">;
export type ClientFormDef = FormDef & { column: ClientFormColumn };
export const CLIENT_FORMS = FORMS.filter(
  (form): form is ClientFormDef => form.column !== "form_nr1" && form.column !== "form_fna",
);

export const formFor = (stage: FormStage) => FORMS.find((f) => f.stage === stage)!;

export function formFieldKeys(def: FormDef): string[] {
  const keys = def.sections.flatMap((s) => s.fields.map((f) => f.key));
  for (const c of def.checks?.items ?? []) if (c.fill) keys.push(c.fill.key);
  return keys;
}

export type Checks = Record<CheckKey, boolean>;

/** 仲差邊幾格先具備簽單條件 */
export function missingChecks(checks: Partial<Checks>): { stage: "RR" | "NR2"; label: string }[] {
  return ALL_CHECKS.filter((c) => !checks[c.key]).map((c) => ({
    stage: c.key.startsWith("rr_") ? "RR" : "NR2",
    label: c.label,
  }));
}

export const isReady = (checks: Partial<Checks>) => missingChecks(checks).length === 0;

export const GENDERS = [
  { value: "M", label: "男" },
  { value: "F", label: "女" },
];

export const MARITAL = [
  { value: "single", label: "單身" },
  { value: "dating", label: "拍拖中" },
  { value: "married", label: "已婚" },
  { value: "divorced", label: "離婚" },
  { value: "widowed", label: "喪偶" },
];

export const INFO_KEYS = ["name", "age", "gender", "occupation", "marital"] as const;

export const INFO_LABELS: Record<(typeof INFO_KEYS)[number], string> = {
  name: "姓名",
  age: "年齡",
  gender: "性別",
  occupation: "職業",
  marital: "婚姻狀況",
};

export function proposalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}
