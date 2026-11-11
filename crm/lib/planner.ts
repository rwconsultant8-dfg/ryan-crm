import { z } from "zod";
import { validTime } from "./followups";
import { isDate } from "./weeks";

export const CATEGORIES = { appointment: "邀約", planning: "計劃", review: "檢討", preparation: "準備", service: "客戶服務" } as const;
export const PLAN_STAGES = { "": "未指定", relationship: "建立關係／了解需要", needs: "客戶需要", presentation: "建議書", closing: "成交", recruitment: "招聘" } as const;
export const STATUSES = { planned: "未完成", done: "已完成", blocked: "待跟進", cancelled: "已取消" } as const;
export const taskInputSchema = z.object({
  day: z.string().refine(isDate, "日期無效"),
  category: z.enum(["appointment", "planning", "review", "preparation", "service"]),
  stage: z.enum(["", "relationship", "needs", "presentation", "closing", "recruitment"]),
  name: z.string().trim().min(1).max(120),
  plan: z.string().trim().min(1).max(1000),
  client_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  time: z.string().refine(validTime, "時間無效").optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;
export type Task = TaskInput & { id: string; owner_id: string; status: keyof typeof STATUSES; result: string; updated_at: string };
export const taskUpdateSchema = z.object({ id: z.string().uuid(), updated_at: z.string(), status: z.enum(["planned", "done", "blocked", "cancelled"]), result: z.string().trim().max(2000) });
export function summarizeTasks(tasks: Task[], today: string) {
  return { total: tasks.length, done: tasks.filter(t => t.status === "done").length,
    open: tasks.filter(t => t.status === "planned" || t.status === "blocked").length,
    overdue: tasks.filter(t => t.day < today && (t.status === "planned" || t.status === "blocked")).length };
}
