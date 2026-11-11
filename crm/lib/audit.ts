import { seasonLabel } from "./seasons";
import { ACTIVITIES, APPT_SLOTS } from "./activity";
import { ALL_CHECKS, FORMS, INFO_LABELS, STAGES, type Stage } from "./stages";

const COLUMN_LABELS: Record<string, string> = {
  stage: "階段",
  season: "四季",
  owner_id: "負責員工",
  id: "記錄",
  full_name: "員工姓名",
  role: "角色",
  active: "帳戶狀態",
  email: "電郵",
  created_by: "建立者",
  day: "日期",
  points: "每日總分",
  afyp: "AFYP",
  revenue: "Revenue",
  commission: "佣金",
  cases: "目標 Case 數",
  month: "月份",
  client_id: "連結客戶卡",
  week_start: "週",
  year: "年份",
};

/** 將審計記錄嘅欄位名轉成中文，例如 form_rr.family → RR・家庭 */
export function fieldLabel(key: string): string {
  const [col, sub] = key.split(".");
  if (col === "info" && sub) return `基本資料・${INFO_LABELS[sub as keyof typeof INFO_LABELS] ?? sub}`;
  if (col === "appts" && sub) return `${APPT_SLOTS.find((s) => s.key === sub)?.label ?? sub}約會`;
  if (col === "focus" && sub) return sub === "plan" ? "宣告 PDCA 焦點" : "PDCA 焦點進度";
  if (col === "data" && sub) return ({ client_name: "生意表・客名", product: "生意表・產品", note: "生意表・備註" } as Record<string, string>)[sub] ?? sub;
  if (col === "okr" && sub) return sub === "objective" ? "OKR 目標" : "OKR 關鍵結果";
  const act = ACTIVITIES.find((a) => a.key === col);
  if (act) return `${act.code} 次數`;
  const form = FORMS.find((f) => f.column === col);
  if (form && sub) {
    const field =
      form.sections.flatMap((s) => s.fields).find((f) => f.key === sub) ??
      form.checks?.items.find((c) => c.fill?.key === sub)?.fill;
    return `${form.stage}・${field?.label ?? sub}`;
  }
  const check = ALL_CHECKS.find((c) => c.key === col);
  if (check) return `${col.startsWith("rr_") ? "RR" : "NR2"} 條件・${check.label}`;
  return COLUMN_LABELS[col] ?? col;
}

function valueLabel(col: string, v: unknown): string {
  if (col === "season" && (v === null || v === undefined)) return "未分類";
  if (v === null || v === undefined) return "—";
  if (col === "stage") return STAGES.find((s) => s.key === (v as Stage))?.short ?? String(v);
  if (col === "season") return seasonLabel(v as string);
  if (col === "active") return v ? "啟用" : "停用";
  if (col === "role") return v === "admin" ? "主管" : "員工";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
}

export type AuditChange = { label: string; detail?: string };

export function describeChanges(changes: Record<string, unknown>, action: string): AuditChange[] {
  const out: AuditChange[] = [];
  for (const [key, val] of Object.entries(changes)) {
    if (["id", "owner_id", "created_by", "email"].includes(key) && action !== "UPDATE") continue;
    if (val === "changed") {
      out.push({ label: fieldLabel(key) });
    } else if (val && typeof val === "object" && "new" in (val as object)) {
      const { old, new: nv } = val as { old: unknown; new: unknown };
      if (action === "UPDATE") out.push({ label: fieldLabel(key), detail: `${valueLabel(key, old)} → ${valueLabel(key, nv)}` });
      else if (action === "INSERT" && nv !== false) out.push({ label: fieldLabel(key), detail: valueLabel(key, nv) });
    }
  }
  return out;
}

export const ACTION_LABELS: Record<string, string> = { INSERT: "新增", UPDATE: "修改", DELETE: "刪除" };
