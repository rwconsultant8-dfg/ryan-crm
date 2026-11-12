import { FORMS, NEED_PRODUCT_SECTIONS, formFor, type FormColumn, type FormDef, type Stage } from "./stages";

export type ClientFormDef = Omit<FormDef, "phase"> & { phase: Stage };

const retiredFactFields = new Set(["helped", "point_a", "point_b"]);
const factFindingSections = formFor("RR").sections.map((section) => ({
  ...section,
  fields: section.fields.filter((field) => !retiredFactFields.has(field.key)).map((field, index) => ({
    ...field, label: field.label.replace(/^\d+\)/, `${index + 1})`),
  })),
})).filter((section) => section.fields.length > 0);

const proposal = formFor("PC");
const serviceForm = (phase: "SIGNED" | "ISSUED", title: string, key: string): ClientFormDef => ({
  ...proposal, phase, title,
  timing: "留意事項逐點記錄，每行一項；詳細內容稍後補充。",
  checks: undefined,
  sections: [{ fields: proposal.sections.flatMap((section) => section.fields).filter((field) => field.key === key) }],
});

/** 沿用現有加密欄位，舊資料毋須遷移。 */
export const CLIENT_FORMS: ClientFormDef[] = [
  { ...formFor("RR"), title: "Fact Finding", timing: "填寫已了解嘅客戶資料，checklist 會自動顯示完成項目。", tips: undefined, checks: undefined, sections: factFindingSections },
  {
    ...formFor("NR1"), timing: "員工自由填寫見面準備。", tips: undefined, checks: undefined,
    sections: [{ fields: [{ key: "notes", label: "見面準備（自由填寫）", type: "textarea" }] }],
  },
  {
    ...formFor("NR2"), title: "Needs 保障和財富增值",
    timing: "勾選客戶已表達嘅產品需要，可選多項。", tips: undefined, checks: undefined,
    sections: [...NEED_PRODUCT_SECTIONS, { fields: [{ key: "notes", label: "跟進記錄（自由填寫）", type: "textarea" }] }],
  },
  {
    ...proposal, title: "Presentation → 共識",
    timing: "令計劃書同客戶嘅需要產生關聯，再進行 Drill。",
    sections: [
      { title: "計劃書", fields: proposal.sections[0].fields },
      proposal.sections.find((section) => section.title === "Presentation 共識與練習")!,
      { fields: [{ key: "notes", label: "補充記錄（自由填寫）", type: "textarea" }] },
    ],
  },
  serviceForm("SIGNED", "Closing", "closing_points"),
  serviceForm("ISSUED", "Referral service", "referral_points"),
];

export function historicalFormEntries(phase: Stage, forms: Record<FormColumn, Record<string, string>>) {
  return FORMS.filter((def) => def.phase === phase).flatMap((def) => {
    // 同一加密欄位可有多個分頁；唔將另一分頁嘅新欄位當成舊記錄。
    const visible = new Set(CLIENT_FORMS.filter((f) => f.column === def.column).flatMap((f) => f.sections.flatMap((s) => s.fields.map((field) => field.key))));
    const fields = [
      ...def.sections.flatMap((section) => section.fields),
      ...(def.checks?.items.flatMap((check) => check.fill ? [check.fill] : []) ?? []),
    ];
    return fields.filter((field) => !visible.has(field.key) && forms[def.column]?.[field.key]?.trim()).map((field) => ({
      key: `${def.column}.${field.key}`, label: `${def.title}・${field.label}`, value: forms[def.column][field.key],
    }));
  });
}

export function factFindingChecklist(info: Record<string, string | undefined>, forms: Record<FormColumn, Record<string, string>>) {
  const basic = [
    ["name", "姓名"], ["age", "年齡"], ["gender", "性別"],
    ["occupation", "職業"], ["marital", "婚姻狀況"], ["customer_type", "客戶類別"],
  ].map(([key, label]) => ({ key: `info.${key}`, label, complete: Boolean(info[key]?.trim()) }));
  const details = factFindingSections
    .flatMap((section) => section.fields)
    .filter((field) => field.key !== "needs")
    .map((field) => ({
      key: `form_rr.${field.key}`,
      label: field.label.replace(/^\d+\)\s*/, ""),
      complete: Boolean(forms.form_rr[field.key]?.trim()),
    }));
  return [...basic, ...details];
}

export function pointFormLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim().replace(/^(?:[-*•・·]\s+|\d+[.)、]\s*)/, "")).filter(Boolean);
}
