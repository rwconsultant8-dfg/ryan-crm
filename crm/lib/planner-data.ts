import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn } from "./secure";
import type { Task } from "./planner";

export async function loadTasks(db: SupabaseClient, from: string, to: string, owner?: string): Promise<Task[]> {
  const tasks: Task[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from("daily_tasks").select("*").gte("day", from).lte("day", to)
      .order("day").order("created_at").order("id").range(offset, offset + pageSize - 1);
    if (owner) query = query.eq("owner_id", owner);
    const { data, error } = await query;
    if (error) throw new Error("每日任務讀取失敗，請稍後重試。");
    for (const row of data ?? []) tasks.push({ ...row, ...decryptColumn(row.id, "info", row.info) } as Task);
    if (!data || data.length < pageSize) return tasks;
  }
}

/** 客戶連結儲存於現有加密 info，毋須改動資料庫；分頁避免漏掉舊逾期待辦。 */
export async function loadFollowups(db: SupabaseClient, owner?: string): Promise<Task[]> {
  const tasks: Task[] = [];
  for (let offset = 0; ; offset += 500) {
    let query=db.from("daily_tasks").select("*").order("day").order("id").range(offset,offset+499);if(owner)query=query.eq("owner_id",owner);
    const {data,error}=await query;
    if (error) throw new Error("未能讀取跟進安排，請稍後重試。");
    for (const row of data ?? []) tasks.push({ ...row, ...decryptColumn(row.id, "info", row.info) } as Task);
    if (!data || data.length < 500) return tasks;
  }
}
