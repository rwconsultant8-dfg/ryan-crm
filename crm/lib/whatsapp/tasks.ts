import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn, encryptColumn } from "../secure";
import { taskInputSchema } from "../planner";
import { isDate } from "../weeks";
import { z } from "zod";

export const taskMessageSchema = taskInputSchema.extend({
  operation: z.enum(["create", "update", "reschedule"]),
  task_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  new_day: z.union([z.string().refine(isDate, "新日期無效"), z.literal("")]).optional(),
  status: z.enum(["planned", "done", "blocked", "cancelled"]),
  result: z.string().trim().max(2000),
});
export type TaskMessage = z.infer<typeof taskMessageSchema>;
export type PreparedTask = { operation: "create" | "update"; id: string; day: string; category: string; stage: string; status: string; info: Record<string,string>; updated_at?: string; rescheduledFrom?: {day:string;time:string} };

/** Resolve before showing the draft; ambiguous matches never become new tasks. */
export async function prepareTasks(db: SupabaseClient, owner: string, input: TaskMessage[], proposedClient?:{id:string;name:string}): Promise<PreparedTask[]> {
  const output: PreparedTask[] = [];
  for (const raw of input) {
    const t = taskMessageSchema.parse(raw);
    if (t.operation === "create") {
      let name=t.name;
      if(t.client_id && proposedClient?.id===t.client_id)name=proposedClient.name;
      else if (t.client_id) {
        const {data:client,error}=await db.from("clients").select("id,info").eq("id",t.client_id).eq("owner_id",owner).maybeSingle();
        if (error || !client) throw new Error("只可以連結自己負責嘅客戶。");
        name=decryptColumn(client.id,"info",client.info).name || name;
      }
      const id = randomUUID();
      output.push({ operation: "create", id, day:t.day, category:t.category, stage:t.stage, status:t.status,
        info: encryptColumn(id,"info",{}, { name,plan:t.plan,result:t.result,client_id:t.client_id || "",time:t.time || "" }) });
      continue;
    }
    const { data, error } = await db.from("daily_tasks").select("*").eq("owner_id",owner).eq("day",t.day).eq("category",t.category);
    if (error) throw new Error("未能讀取待辦，請稍後再試。");
    const matches = (data ?? []).filter(r => {
      if (t.task_id && r.id !== t.task_id) return false;
      const v = decryptColumn(r.id,"info",r.info);
      return v.name.trim().toLowerCase() === t.name.trim().toLowerCase() && (!t.stage || r.stage === t.stage);
    });
    if (matches.length !== 1) throw new Error(`「${t.name}」待辦未能唯一配對，請講清楚原本計劃日期、工作欄及 stage，或者喺 app 更新。`);
    const row = matches[0];
    const original = decryptColumn(row.id,"info",row.info);
    if (t.operation === "reschedule") {
      if (row.status !== "planned" && row.status !== "blocked") throw new Error("呢項安排已完成或已取消，請核對要改期嘅安排。");
      if (t.client_id && t.client_id !== (original.client_id || "")) throw new Error("改期唔可以更改原本客戶連結。");
      if (t.status !== "planned") throw new Error("改期後嘅安排必須係未完成。");
      const day = t.new_day || row.day, time = t.time || original.time || "";
      if (day === row.day && time === (original.time || "")) throw new Error("請講返新日期或新時間；原有安排未有改動。");
      if (output.some(x => x.id === row.id)) throw new Error("同一安排有多項更新，請合併提交。");
      const note = `改期至 ${day}${time ? ` ${time}` : ""}`;
      output.push({ operation:"update", id:row.id, day:row.day, category:row.category, stage:row.stage, status:"cancelled", updated_at:row.updated_at,
        info:encryptColumn(row.id,"info",row.info,{result:[original.result,note].filter(Boolean).join("\n")}) });
      const id = randomUUID();
      output.push({ operation:"create", id, day, category:row.category, stage:row.stage, status:"planned",
        info:encryptColumn(id,"info",{}, {...original,time,result:""}), rescheduledFrom:{day:row.day,time:original.time || ""} });
      continue;
    }
    if ((t.client_id!==undefined && t.client_id!==(original.client_id || "")) || (t.time!==undefined && t.time!=="" && t.time!==(original.time || ""))) throw new Error("更新結果唔會改動原定客戶連結或時間，請取消原任務再重新安排。");
    if (output.some(x => x.id === row.id)) throw new Error("同一待辦有多項更新，請合併成一個結果。");
    output.push({ operation:"update", id:row.id, day:row.day, category:row.category, stage:row.stage, status:t.status, updated_at:row.updated_at,
      info:encryptColumn(row.id,"info",row.info,{ result:t.result }) });
  }
  if (output.length > 30) throw new Error("今次改期項目太多，請分批提交（每次最多15項改期）。");
  return output;
}
