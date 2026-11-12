"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { decryptColumn, encryptColumn } from "@/lib/secure";
import { taskInputSchema, taskUpdateSchema } from "@/lib/planner";

export async function createTask(input: unknown) {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) return { error: "請填日期、對象同計劃。" };
  const { supabase, profile } = await requireUser();
  const { name, plan, client_id, time, period, ...rest } = parsed.data;
  let taskName = name;
  if (client_id) {
    const { data: client, error: accessError } = await supabase.from("clients").select("id, info").eq("id", client_id).eq("owner_id", profile.id).maybeSingle();
    if (accessError || !client) return { error: "只可以連結自己負責嘅客戶。" };
    taskName = decryptColumn(client_id,"info",client.info).name || name;
  }
  const id = randomUUID();
  const { error } = await supabase.from("daily_tasks").insert({ id, owner_id: profile.id, ...rest, info: encryptColumn(id, "info", {}, { name: taskName, plan, result: "", client_id: client_id || "", time: time || "", period: period || "" }) });
  if (error) return { error: "儲存失敗，請稍後再試。" };
  revalidatePath("/today"); revalidatePath("/review"); revalidatePath("/board"); revalidatePath("/seasons"); revalidatePath("/activity");
  if (client_id) revalidatePath(`/clients/${client_id}`);
  return { error: "" };
}
export async function updateTask(input: unknown) {
  const parsed = taskUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "更新資料無效。" };
  const { supabase, profile } = await requireUser();
  const p = parsed.data;
  const { data: row, error: readError } = await supabase.from("daily_tasks").select("info").eq("id", p.id).eq("owner_id", profile.id).single();
  if (readError || !row) return { error: "搵唔到你嘅待辦。" };
  const { data, error } = await supabase.from("daily_tasks").update({ status: p.status, info: encryptColumn(p.id, "info", row.info, { result: p.result }) })
    .eq("id", p.id).eq("owner_id", profile.id).eq("updated_at", p.updated_at).select("id");
  if (error || !data?.length) return { error: "未能儲存，記錄可能已更新；請重新載入再試。" };
  revalidatePath("/today"); revalidatePath("/review"); revalidatePath("/board"); revalidatePath("/seasons"); revalidatePath("/activity");
  const linked = decryptColumn(p.id, "info", row.info).client_id;
  if (linked && /^[0-9a-f-]{36}$/i.test(linked)) revalidatePath(`/clients/${linked}`);
  return { error: "" };
}
