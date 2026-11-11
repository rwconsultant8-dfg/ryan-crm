"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { listTelegramLinks, validTelegramId } from "@/lib/telegram/registry";

export type StaffResult = { ok: boolean; message: string } | null;

const BAN_FOREVER = "876000h"; // 約 100 年

function checkPassword(pw: string): string | null {
  if (pw.length < 10) return "臨時密碼最少 10 個字元";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "臨時密碼要有英文字母同數字";
  return null;
}

export async function createStaffAction(_prev: StaffResult, formData: FormData): Promise<StaffResult> {
  const { profile: me } = await requireAdmin();
  const full_name = String(formData.get("full_name") ?? "").trim().slice(0, 100);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!full_name || !email) return { ok: false, message: "請填姓名同電郵" };
  const bad = checkPassword(password);
  if (bad) return { ok: false, message: bad };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { full_name, created_by: me.id },
  });
  if (error) {
    return { ok: false, message: error.message.includes("already") ? "呢個電郵已經有帳戶" : "開帳戶失敗：" + error.message };
  }
  revalidatePath("/admin/staff");
  revalidatePath("/admin");
  return { ok: true, message: `已開設 ${full_name}（${email}）。請將臨時密碼私下交俾佢，登入後喺「我的帳戶」改密碼。` };
}

export async function setActiveAction(userId: string, active: boolean): Promise<StaffResult> {
  const { supabase, profile: me } = await requireAdmin();
  if (userId === me.id) return { ok: false, message: "唔可以停用自己" };

  // 1) 用主管自己嘅身份改 profile（受 RLS 保護 + 審計記錄會寫低係主管改）
  const { data, error } = await supabase.from("profiles").update({ active }).eq("id", userId).select("id");
  if (error || !data?.length) return { ok: false, message: "更新失敗：" + (error?.message ?? "搵唔到員工") };

  // 2) 喺 Auth 層面封鎖／解封登入
  const admin = createAdminClient();
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : BAN_FOREVER });
  if (banErr) return { ok: false, message: "帳戶狀態已更新，但登入封鎖失敗：" + banErr.message };

  revalidatePath("/admin/staff");
  revalidatePath("/admin");
  return { ok: true, message: active ? "已重新啟用" : "已停用（即時睇唔到任何客戶資料，亦登入唔到）" };
}

export async function renameAction(userId: string, full_name: string): Promise<StaffResult> {
  const { supabase } = await requireAdmin();
  const name = full_name.trim().slice(0, 100);
  if (!name) return { ok: false, message: "姓名唔可以空白" };
  const { data, error } = await supabase.from("profiles").update({ full_name: name }).eq("id", userId).select("id");
  if (error || !data?.length) return { ok: false, message: "更新失敗" };
  revalidatePath("/admin/staff");
  return { ok: true, message: "已更新姓名" };
}

export async function resetPasswordAction(userId: string, password: string): Promise<StaffResult> {
  await requireAdmin();
  const bad = checkPassword(password);
  if (bad) return { ok: false, message: bad };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, message: "重設失敗：" + error.message };
  return { ok: true, message: "已重設密碼，請私下交俾員工" };
}

export async function setTelegramAction(userId: string, rawId: string): Promise<StaffResult> {
  const { supabase } = await requireAdmin();
  const value = rawId.trim();
  if (value && !validTelegramId(value)) return { ok: false, message: "請填助手顯示嘅數字帳戶 ID，唔係電話號碼或 @username。" };
  const { data: target } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!target) return { ok: false, message: "搵唔到員工" };
  const admin = createAdminClient();
  try {
    const links = await listTelegramLinks(admin);
    if (value && [...links].some(([owner, id]) => owner !== userId && id === value)) return { ok: false, message: "呢個 Telegram 帳戶已綁定其他員工。" };
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return { ok: false, message: "未能讀取員工帳戶" };
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { app_metadata: { ...data.user.app_metadata, telegram_user_id: value || null } });
    if (updateError) return { ok: false, message: "未能更新 Telegram 綁定" };
  } catch { return { ok: false, message: "未能更新 Telegram 綁定，請稍後重試。" }; }
  revalidatePath("/admin/staff");
  revalidatePath("/telegram");
  return { ok: true, message: value ? `已綁定 Telegram：${value}` : "已解除 Telegram 綁定" };
}
