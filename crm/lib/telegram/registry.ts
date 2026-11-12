import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const validTelegramId = (value: string) => /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));

/** Bindings live in admin-only Auth app_metadata; users cannot edit their own mapping. */
export async function listTelegramLinks(admin: SupabaseClient): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("未能讀取 Telegram 綁定");
    for (const user of data.users) {
      const id = user.app_metadata?.telegram_user_id;
      if (typeof id === "string" && validTelegramId(id)) links.set(user.id, id);
    }
    if (data.users.length < 100) return links;
  }
  throw new Error("Telegram 綁定名單過大，請聯絡管理員");
}

export async function resolveTelegramAgent(admin: SupabaseClient, telegramId: string) {
  if (!validTelegramId(telegramId)) return null;
  const links = await listTelegramLinks(admin);
  const matches = [...links].filter(([, id]) => id === telegramId);
  // Concurrent or manually-created duplicate bindings must fail closed.
  if (matches.length !== 1) return null;
  const { data, error } = await admin.from("profiles").select("id, active").eq("id", matches[0][0]).maybeSingle();
  if (error) throw new Error("未能驗證員工帳戶");
  return data?.active ? { id: data.id as string } : null;
}
