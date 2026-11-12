"use server";
import {normalizeAge} from "@/lib/age";
import {isCustomerType} from "@/lib/customer-types";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { decryptColumn, encryptColumn } from "@/lib/secure";
import { readContactHistory } from "@/lib/followups";
import { MEETING_FOCUS_LIMIT, readMeetingFocus } from "@/lib/meeting";
import { hkToday, isDate } from "@/lib/weeks";
import { isSeason, seasonForStage, stageForSeason, pipelinePatch } from "@/lib/seasons";
import {
  FORMS,
  GENDERS,
  INFO_KEYS,
  MARITAL,
  PROPOSAL_FIELD_ALIASES,
  REFERRAL_STAGE_KEY,
  formFieldKeys,
  isStage,
  proposalUrl,
  storageStage,
  type CheckKey,
  type FormStage,
  type FormDef,
} from "@/lib/stages";

export type ActionResult = { ok: true } | { ok: false, error: string };

const MAX_LEN = 5000;
const NO_ACCESS = "冇權限修改呢個客（只可以改自己嘅客）";

function cleanInfo(raw: Record<string, unknown>): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const k of INFO_KEYS) {
    if (k === "customer_type" && raw[k] === undefined) continue;
    out[k] = String(raw[k] ?? "").trim().slice(0, 200);
  }
  if (!out.name) return "請填姓名";
  const age=normalizeAge(out.age);
  if(age===null)return "年齡可填 55、50幾、約55 或 50-59";
  out.age=age;
  if (out.gender && !GENDERS.some((g) => g.value === out.gender)) return "性別無效";
  if (out.marital && !MARITAL.some((m) => m.value === out.marital)) return "婚姻狀況無效";
  if (out.customer_type !== undefined && !isCustomerType(out.customer_type)) return "客戶類別無效";
  return out;
}

export async function createClientAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const { supabase, profile } = await requireUser();
  const info = cleanInfo(Object.fromEntries(formData));
  if (typeof info === "string") return info;

  const id = randomUUID();
  const { error } = await supabase.from("clients").insert({
    id,
    owner_id: profile.id,
    info: encryptColumn(id, "info", {}, info),
  });
  if (error) return "儲存失敗：" + error.message;
  revalidatePath("/board");
  redirect(`/clients/${id}`);
}

async function updateOwn(id: string, patch: Record<string, unknown>, updatedAt?: string): Promise<ActionResult> {
  const { supabase, profile } = await requireUser();
  let query = supabase.from("clients").update(patch).eq("id", id).eq("owner_id", profile.id);
  if (updatedAt) query = query.eq("updated_at", updatedAt);
  const { data, error } = await query.select("id");
  if (error) return { ok: false, error: "儲存失敗：" + error.message };
  if (!data || data.length !== 1) return { ok: false, error: updatedAt ? "客戶資料啱啱有更新，未有覆蓋新內容；請重新載入後再儲存。" : NO_ACCESS };
  revalidatePath("/board");
  revalidatePath("/seasons");
  revalidatePath(`/clients/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

async function loadEnc(id: string, column: string): Promise<{ encrypted: Record<string, string>; updatedAt?: string } | null> {
  const { supabase, profile } = await requireUser();
  const { data } = await supabase.from("clients").select(`owner_id, updated_at, ${column}`).eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row || row.owner_id !== profile.id) return null;
  return { encrypted: (row[column] as Record<string, string>) ?? {}, updatedAt: row.updated_at as string | undefined };
}

export async function saveMeetingFocusAction(id: string, focus: string, previous: string | null): Promise<ActionResult> {
  if (typeof focus !== "string" || focus.length > MEETING_FOCUS_LIMIT) {
    return { ok: false, error: "今次重點最多 1500 字。" };
  }

  const existing = await loadEnc(id, "info");
  if (!existing?.updatedAt) return { ok: false, error: NO_ACCESS };
  const saved = readMeetingFocus(decryptColumn(id, "info", existing.encrypted).meeting_focus);
  if (saved !== previous) return { ok: false, error: "今次重點啱啱有更新，請重新載入後再修改。" };

  const next = focus.trim();
  if (next === saved) return { ok: true };
  const info = encryptColumn(id, "info", existing.encrypted, { meeting_focus: JSON.stringify(next) });
  return updateOwn(id, { info }, existing.updatedAt);
}

export async function updateInfoAction(id: string, raw: Record<string, string>): Promise<ActionResult> {
  const existing = await loadEnc(id, "info");
  if (!existing) return { ok: false, error: NO_ACCESS };
  const patch = cleanInfoChanges(id, existing.encrypted, raw);
  if (typeof patch === "string") return { ok: false, error: patch };
  return updateOwn(id, { info: patch }, existing.updatedAt);
}

function cleanInfoChanges(id: string, existing: Record<string, string>, raw: Record<string, string>) {
  const submitted = INFO_KEYS.filter((key) => Object.hasOwn(raw, key));
  const info = cleanInfo({
    ...decryptColumn(id, "info", existing),
    ...Object.fromEntries(submitted.map((key) => [key, raw[key]])),
  });
  if (typeof info === "string") return info;
  return encryptColumn(id, "info", existing, Object.fromEntries(submitted.map((key) => [key, info[key]])));
}

function cleanForm(def: FormDef, values: Record<string, string>): Record<string, string> | string {
  const allowed = formFieldKeys(def);
  const fieldType = new Map(def.sections.flatMap((s) => s.fields).map((f) => [f.key, f.type]));
  const clean: Record<string, string> = {};
  for (const k of allowed) {
    // 簡化表單只提交可見欄位，未提交的舊欄位沿用加密原值。
    if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
    const v = String(values[k] ?? "").slice(0, MAX_LEN);
    const t = fieldType.get(k);
    if (t === "checkbox" && v !== "" && v !== "true") return "產品選項無效";
    if (v.trim() && t === "number" && !Number.isFinite(Number(v.replace(/[,\s]/g, "")))) {
      return "金額要係數字";
    }
    if (v.trim() && t === "rating" && !/^(10|[1-9])$/.test(v.trim())) {
      return "自評要係 1–10";
    }
    if (v.trim() && t === "url" && !proposalUrl(v.trim())) return "請填寫有效嘅 HTTPS 計劃書連結";
    clean[k] = v;
  }
  return clean;
}

export async function saveFormAction(
  id: string,
  stage: FormStage,
  values: Record<string, string>,
  checks: Partial<Record<CheckKey, boolean>>,
): Promise<ActionResult> {
  const def = FORMS.find((f) => f.stage === stage);
  if (!def) return { ok: false, error: "表格無效" };
  const clean = cleanForm(def, values);
  if (typeof clean === "string") return { ok: false, error: clean };

  const existing = await loadEnc(id, def.column);
  if (!existing) return { ok: false, error: NO_ACCESS };
  if (def.column === "form_pc") {
    const previous = decryptColumn(id, def.column, existing.encrypted);
    for (const [key, legacy] of Object.entries(PROPOSAL_FIELD_ALIASES)) {
      if (legacy && Object.hasOwn(clean, key) && previous[legacy] !== undefined) {
        clean[`cleared_${key}`] = clean[key].trim() ? "" : "true";
      }
    }
  }

  const patch: Record<string, unknown> = { [def.column]: encryptColumn(id, def.column, existing.encrypted, clean) };
  for (const c of def.checks?.items ?? []) {
    if (typeof checks[c.key] === "boolean") patch[c.key] = checks[c.key];
  }
  return updateOwn(id, patch, existing.updatedAt);
}

export async function saveFactFindingAction(
  id: string,
  info: Record<string, string>,
  forms: Partial<Record<"form_rr" | "form_nr1", Record<string, string>>>,
  checks: Partial<Record<CheckKey, boolean>>,
): Promise<ActionResult> {
  const { supabase, profile } = await requireUser();
  const { data: row, error } = await supabase.from("clients")
    .select("owner_id, updated_at, info, form_rr, form_nr1").eq("id", id).eq("owner_id", profile.id).maybeSingle();
  if (error || !row || !row.updated_at) return { ok: false, error: NO_ACCESS };

  const patch: Record<string, unknown> = {};
  if (Object.keys(info).length) {
    const next = cleanInfoChanges(id, row.info ?? {}, info);
    if (typeof next === "string") return { ok: false, error: next };
    patch.info = next;
  }
  for (const column of ["form_rr", "form_nr1"] as const) {
    const values = forms[column];
    if (!values) continue;
    const def = FORMS.find((form) => form.column === column)!;
    const clean = cleanForm(def, values);
    if (typeof clean === "string") return { ok: false, error: clean };
    patch[column] = encryptColumn(id, column, row[column], clean);
  }
  for (const { key } of FORMS.find((form) => form.stage === "RR")?.checks?.items ?? []) {
    if (typeof checks[key] === "boolean") patch[key] = checks[key];
  }
  return Object.keys(patch).length ? updateOwn(id, patch, row.updated_at) : { ok: true };
}

async function setStage(id: string, stage: string, season: string | null): Promise<ActionResult> {
  const existing = await loadEnc(id, "form_pc");
  if (!existing) return { ok: false, error: NO_ACCESS };
  const patch: Record<string, unknown> = { stage, season };
  if (Object.hasOwn(existing.encrypted, REFERRAL_STAGE_KEY)) {
    patch.form_pc = encryptColumn(id, "form_pc", existing.encrypted, { [REFERRAL_STAGE_KEY]: "" });
  }
  return updateOwn(id, patch, existing.updatedAt);
}

export async function moveStageAction(id: string, stage: string): Promise<ActionResult> {
  if (!isStage(stage)) return { ok: false, error: "階段無效" };
  return setStage(id, storageStage(stage), seasonForStage(stage));
}

export async function moveSeasonAction(id: string, season: string | null): Promise<ActionResult> {
  if (season !== null && !isSeason(season)) return { ok: false, error: "人脈分類無效" };
  const { supabase, profile } = await requireUser();
  const { data: row, error } = await supabase.from("clients").select("stage").eq("id",id).eq("owner_id",profile.id).maybeSingle();
  if (error || !row) return {ok:false,error:NO_ACCESS};
  let patch:Record<string,string>;
  try {patch=pipelinePatch({season},row.stage);} catch(e) {return {ok:false,error:e instanceof Error ? e.message : "分類無效"};}
  const res = await updateOwn(id, patch);
  revalidatePath("/seasons");
  return res;
}

/** 由「已簽」撤回：一次過將階段改返 PC 同設定人脈分類 */
export async function unsignAction(id: string, season: string | null): Promise<ActionResult> {
  if (season !== null && !isSeason(season)) return { ok: false, error: "人脈分類無效" };
  const res = await setStage(id, storageStage(stageForSeason(season)), season);
  revalidatePath("/seasons");
  return res;
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("clients").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: "刪除失敗：" + error.message };
  if (!data || data.length !== 1) return { ok: false, error: NO_ACCESS };
  revalidatePath("/board");
  redirect("/board");
}


/** 記錄實際聯絡或備註；版本條件避免兩個視窗互相覆蓋歷史。 */
export async function addContactEventAction(id: string, text: string, kind: string, day: string): Promise<ActionResult> {
  if (!text.trim() || text.length>2000 || !["contact","note"].includes(kind) || !isDate(day) || day>hkToday()) return {ok:false,error:"請填寫有效日期同記錄（最多 2000 字）。"};
  const { supabase, profile } = await requireUser();
  const { data: row, error: readError } = await supabase.from("clients").select("info, updated_at").eq("id",id).eq("owner_id",profile.id).maybeSingle();
  if (readError || !row) return {ok:false,error:NO_ACCESS};
  const info = decryptColumn(id,"info",row.info);
  const history = readContactHistory(info.contact_history);
  if (info.contact_history) {
    try { const raw = JSON.parse(info.contact_history); if (!Array.isArray(raw) || history.length!==raw.length) return {ok:false,error:"舊記錄格式有問題，請先檢查，未有覆蓋原有內容。"}; }
    catch { return {ok:false,error:"未能讀取舊記錄，未有覆蓋原有內容。"}; }
  }
  history.push({id:randomUUID(),at:new Date().toISOString(),day,text:text.trim(),kind:kind as "contact"|"note"});
  const serialized = JSON.stringify(history);
  if (serialized.length>250000) return {ok:false,error:"記錄已達容量上限，請聯絡管理員協助保留歷史記錄。"};
  const patch:Record<string,string> = {contact_history:serialized};
  if (kind==="contact" && day>(info.last_contact_at || "")) patch.last_contact_at=day;
  const { data, error } = await supabase.from("clients").update({info:encryptColumn(id,"info",row.info,patch)}).eq("id",id).eq("owner_id",profile.id).eq("updated_at",row.updated_at).select("id");
  if (error || !data?.length) return {ok:false,error:"未能儲存，記錄可能已更新；請重新載入再試。"};
  for (const path of ["/board","/seasons","/today",`/clients/${id}`]) revalidatePath(path);
  return {ok:true};
}
