"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { encryptColumn } from "@/lib/secure";
import { isSeason } from "@/lib/seasons";
import {
  FOLLOW_UPS,
  CLIENT_FORMS,
  REFERRAL_STAGE_KEY,
  GENDERS,
  INFO_KEYS,
  MARITAL,
  formFieldKeys,
  isPipelineStage,
  proposalUrl,
  type CheckKey,
  type FormStage,
  type FollowUp,
  type PipelineStage,
} from "@/lib/stages";

export type ActionResult = { ok: true } | { ok: false, error: string };

const MAX_LEN = 5000;
const NO_ACCESS = "冇權限修改呢個客（只可以改自己嘅客）";

function cleanInfo(raw: Record<string, unknown>): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const k of INFO_KEYS) out[k] = String(raw[k] ?? "").trim().slice(0, 200);
  if (!out.name) return "請填姓名";
  if (out.age && !/^\d{1,3}$/.test(out.age)) return "年齡要係數字";
  if (out.gender && !GENDERS.some((g) => g.value === out.gender)) return "性別無效";
  if (out.marital && !MARITAL.some((m) => m.value === out.marital)) return "婚姻狀況無效";
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

async function updateOwn(
  id: string,
  patch: Record<string, unknown>,
  expected?: { column: string; value: Record<string, string> },
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  let query = supabase.from("clients").update(patch).eq("id", id);
  if (expected) query = query.eq(expected.column, JSON.stringify(expected.value));
  const { data, error } = await query.select("id");
  if (error) return { ok: false, error: "儲存失敗：" + error.message };
  if (!data || data.length !== 1) {
    return { ok: false, error: expected ? "資料已更新或冇權限修改，請重新載入客戶卡再試。" : NO_ACCESS };
  }
  revalidatePath("/board");
  revalidatePath(`/clients/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}

async function loadEnc(id: string, column: string): Promise<Record<string, string> | null> {
  const { supabase, profile } = await requireUser();
  const { data } = await supabase.from("clients").select(`owner_id, ${column}`).eq("id", id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row || row.owner_id !== profile.id) return null;
  return (row[column] as Record<string, string>) ?? {};
}

export async function updateInfoAction(id: string, raw: Record<string, string>): Promise<ActionResult> {
  const info = cleanInfo(raw);
  if (typeof info === "string") return { ok: false, error: info };
  const existing = await loadEnc(id, "info");
  if (!existing) return { ok: false, error: NO_ACCESS };
  return updateOwn(id, { info: encryptColumn(id, "info", existing, info) });
}

export async function saveFormAction(
  id: string,
  stage: FormStage,
  values: Record<string, string>,
  checks: Partial<Record<CheckKey, boolean>>,
  followUp?: FollowUp,
): Promise<ActionResult> {
  const def = CLIENT_FORMS.find((f) => f.stage === stage);
  if (!def || (followUp !== undefined && (stage !== "PC" || !FOLLOW_UPS.some((item) => item.key === followUp)))) {
    return { ok: false, error: "表格無效" };
  }

  const sections = def.sections.filter((section) => section.followUp === followUp);
  const allowed = formFieldKeys({ ...def, sections });
  const fieldType = new Map(sections.flatMap((s) => s.fields).map((f) => [f.key, f.type]));
  const clean: Record<string, string> = {};
  for (const k of allowed) {
    const v = String(values[k] ?? "").slice(0, MAX_LEN);
    const t = fieldType.get(k);
    if (v.trim() && t === "number" && !Number.isFinite(Number(v.replace(/[,\s]/g, "")))) {
      return { ok: false, error: "金額要係數字" };
    }
    if (v.trim() && t === "rating" && !/^(10|[1-9])$/.test(v.trim())) {
      return { ok: false, error: "自評要係 1–10" };
    }
    if (t === "url" && v.trim() && !proposalUrl(v)) {
      return { ok: false, error: "請填寫有效嘅 HTTPS 計劃書連結" };
    }
    clean[k] = t === "checkbox" ? (v === "true" ? "true" : "") : v;
  }

  const existing = await loadEnc(id, def.column);
  if (!existing) return { ok: false, error: NO_ACCESS };

  const patch: Record<string, unknown> = { [def.column]: encryptColumn(id, def.column, existing, clean) };
  for (const c of def.checks?.items ?? []) patch[c.key] = Boolean(checks[c.key]);
  return updateOwn(id, patch, { column: def.column, value: existing });
}

async function updateStage(id: string, stage: PipelineStage, season?: string | null): Promise<ActionResult> {
  const existing = await loadEnc(id, "form_pc");
  if (!existing) return { ok: false, error: NO_ACCESS };

  const patch: Record<string, unknown> = { stage: stage === "REFERRAL" ? "SIGNED" : stage };
  if (season !== undefined) patch.season = season;
  if (stage === "REFERRAL" || REFERRAL_STAGE_KEY in existing) {
    patch.form_pc = encryptColumn(id, "form_pc", existing, {
      [REFERRAL_STAGE_KEY]: stage === "REFERRAL" ? "true" : "",
    });
  }
  const res = await updateOwn(id, patch, { column: "form_pc", value: existing });
  if (res.ok) revalidatePath("/seasons");
  return res;
}

export async function moveStageAction(id: string, stage: string): Promise<ActionResult> {
  if (!isPipelineStage(stage)) return { ok: false, error: "階段無效" };
  return updateStage(id, stage);
}

export async function moveSeasonAction(id: string, season: string | null): Promise<ActionResult> {
  if (season !== null && !isSeason(season)) return { ok: false, error: "季節無效" };
  const res = await updateOwn(id, { season });
  revalidatePath("/seasons");
  return res;
}

/** 由「已簽」撤回：一次過將階段改返 PC 同設定季節 */
export async function unsignAction(id: string, season: string | null): Promise<ActionResult> {
  if (season !== null && !isSeason(season)) return { ok: false, error: "季節無效" };
  return updateStage(id, "PC", season);
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("clients").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: "刪除失敗：" + error.message };
  if (!data || data.length !== 1) return { ok: false, error: NO_ACCESS };
  revalidatePath("/board");
  redirect("/board");
}
