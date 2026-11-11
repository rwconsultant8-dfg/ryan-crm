"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { appointmentClientKey, appointmentTimeKey, validTime } from "@/lib/followups";
import { APPT_SLOTS } from "@/lib/activity";
import { apptRecordId } from "@/lib/activity-data";
import { encryptColumn } from "@/lib/secure";
import { addDays, isDate, weekdayIndex } from "@/lib/weeks";

export type SaveResult = { ok: true } | { ok: false; error: string };

type DayInput = { day: string; appts: Record<string, string> };

export async function saveActivityWeekAction(monday: string, days: DayInput[]): Promise<SaveResult> {
  if (!isDate(monday) || weekdayIndex(monday) !== 0) return { ok: false, error: "週次無效" };
  const sunday = addDays(monday, 6);
  if (!Array.isArray(days) || days.length > 7 || new Set(days.map(d=>d?.day)).size!==days.length) return { ok: false, error: "資料無效" };
  for (const d of days) {
    if (!d || typeof d !== "object" || !isDate(d.day) || d.day < monday || d.day > sunday) return { ok: false, error: "日期唔喺呢個星期" };
  }

  const { supabase, profile } = await requireUser();
  const linkedIds = [...new Set(days.flatMap(d=>APPT_SLOTS.map(s=>String(d.appts?.[appointmentClientKey(s.key)] || "")).filter(Boolean)))];
  if (linkedIds.some(id=>!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id))) return { ok:false, error:"客戶連結無效" };
  if (days.some(d=>APPT_SLOTS.some(s=>!validTime(String(d.appts?.[appointmentTimeKey(s.key)] || ""))))) return { ok:false,error:"appointment 時間無效" };
  if (linkedIds.length) {
    const { data: allowed, error: accessError } = await supabase.from("clients").select("id").eq("owner_id",profile.id).in("id",linkedIds);
    if (accessError || allowed?.length !== linkedIds.length) return {ok:false,error:"只可以連結自己負責嘅客戶。"};
  }
  const { data: existing, error: loadErr } = await supabase
    .from("activity_days")
    .select("id, day, appts")
    .eq("owner_id", profile.id)
    .gte("day", monday)
    .lte("day", sunday);
  if (loadErr) return { ok: false, error: "讀取失敗：" + loadErr.message };
  const byDay = new Map((existing ?? []).map((r) => [r.day as string, r]));

  for (const d of days) {
    const appts: Record<string, string> = {};
    for (const s of APPT_SLOTS) {
      appts[s.key] = String(d.appts?.[s.key] ?? "").slice(0, 300);
      // 舊版本送來嘅資料冇 metadata 時保留現有連結；新 UI 明確送空字串先解除。
      for (const key of [appointmentClientKey(s.key), appointmentTimeKey(s.key)]) {
        if (Object.prototype.hasOwnProperty.call(d.appts || {}, key)) appts[key] = String(d.appts[key] || "");
      }
    }
    const row = byDay.get(d.day);
    const enc = encryptColumn(apptRecordId(profile.id, d.day), "appts", row?.appts ?? {}, appts);

    if (row) {
      const { error } = await supabase.from("activity_days").update({ appts: enc }).eq("id", row.id);
      if (error) return { ok: false, error: "儲存失敗：" + error.message };
    } else {
      const empty = Object.keys(enc).length === 0;
      if (empty) continue;
      const { error } = await supabase
        .from("activity_days")
        .insert({ owner_id: profile.id, day: d.day, appts: enc });
      if (error) return { ok: false, error: "儲存失敗：" + error.message };
    }
  }
  revalidatePath("/activity");
  revalidatePath("/today");
  for (const id of linkedIds) revalidatePath(`/clients/${id}`);
  revalidatePath("/admin");
  return { ok: true };
}
