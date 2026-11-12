// AI 由 WhatsApp 訊息抽出嚟嘅結構（同時用嚟做 JSON schema 同驗證）
import {meetingSchema,meetingJsonSchema} from "../meeting";
import { z } from "zod";
import { taskMessageSchema } from "./tasks";
import { ACTIVITY_KEYS, APPT_SLOTS } from "../activity";
import { CHECK_KEYS, FORMS, GENDERS, MARITAL, STAGE_KEYS } from "../stages";
import { SEASONS } from "../seasons";
import { hkToday } from "../weeks";

/** 所有表格欄位，例如 "form_rr.family" */
export const FIELD_IDS = FORMS.flatMap((f) => [
  ...f.sections.flatMap((s) => s.fields.map((x) => `${f.column}.${x.key}`)),
  ...(f.checks?.items.flatMap((c) => (c.fill ? [`${f.column}.${c.fill.key}`] : [])) ?? []),
]);

export const APPT_KEYS = APPT_SLOTS.map((s) => s.key);

export const extractionSchema = z.object({
  client: z.object({
    name: z.string(),
    age: z.string(),
    birth_date: z.string().max(40).optional(),
    gender: z.enum(["", ...GENDERS.map((g) => g.value)] as [string, ...string[]]),
    occupation: z.string(),
    marital: z.enum(["", ...MARITAL.map((m) => m.value)] as [string, ...string[]]),
    customer_type: z.enum(["", "new", "existing"]).optional(),
  }),
  fields: z.array(z.object({ field: z.enum(FIELD_IDS as [string, ...string[]]), text: z.string() })),
  checks: z.array(z.enum(CHECK_KEYS as [string, ...string[]])),
  stage: z.enum(["", ...STAGE_KEYS] as [string, ...string[]]),
  season: z.enum(["", ...SEASONS.map((s) => s.key)] as [string, ...string[]]),
  activity: z.object(Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, z.number().int().min(0).max(20)])) as Record<
    (typeof ACTIVITY_KEYS)[number],
    z.ZodNumber
  >),
  appointment: z.object({ slot: z.enum(["", ...APPT_KEYS]), text: z.string() }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary: z.string(),
  clarification: z.string().optional(),
  client_names: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  tasks: z.array(taskMessageSchema).max(30).optional(),
  meeting:meetingSchema.optional(),
  response: z.object({ kind: z.enum(["chat", "update"]), text: z.string().max(3000) }).optional(),
});

export type Extraction = z.infer<typeof extractionSchema>;

// A conversation answer never needs valid CRM fields. Discard any such fields
// before validation or delivery so a question cannot become a write request.
export const assistantResultSchema = z.union([
  z.object({ response: z.object({ kind: z.literal("chat"), text: z.string().trim().min(1).max(3000) }) }).transform(({ response }): Extraction => ({
    response, client: { name: "", age: "", gender: "", occupation: "", marital: "" }, fields: [], checks: [], stage: "", season: "",
    activity: Object.fromEntries(ACTIVITY_KEYS.map((key) => [key, 0])) as Extraction["activity"],
    appointment: { slot: "", text: "" }, date: hkToday(), summary: "", client_names: [], tasks: [],
  })),
  extractionSchema,
]);

/** 俾 Claude structured outputs 用嘅 JSON schema（全部欄位必填、唔准多餘 key） */
export const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["response", "client", "fields", "checks", "stage", "season", "activity", "appointment", "date", "summary", "tasks", "meeting", "clarification", "client_names"],
  properties: {
    response: { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { type: "string", enum: ["chat", "update"] }, text: { type: "string" } } },
    client: {
      type: "object",
      additionalProperties: false,
      required: ["name", "age", "birth_date", "gender", "occupation", "marital", "customer_type"],
      properties: {
        name: { type: "string" },
        age: { type: "string", description: "客戶本人目前年齡；50幾歲填50幾，約55歲填約55，50至59歲填50-59。保留不確定程度，唔推算確實年齡。" },
        birth_date: { type: "string", description: "原文中客戶本人完整出生年月日，資料不足留空。" },
        gender: { type: "string", enum: ["", ...GENDERS.map((g) => g.value)] },
        occupation: { type: "string" },
        marital: { type: "string", enum: ["", ...MARITAL.map((m) => m.value)] },
        customer_type: { type: "string", enum: ["", "new", "existing"] },
      },
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "text"],
        properties: { field: { type: "string", enum: FIELD_IDS }, text: { type: "string" } },
      },
    },
    checks: { type: "array", items: { type: "string", enum: CHECK_KEYS } },
    stage: { type: "string", enum: ["", ...STAGE_KEYS] },
    season: { type: "string", enum: ["", ...SEASONS.map((s) => s.key)] },
    activity: {
      type: "object",
      additionalProperties: false,
      required: [...ACTIVITY_KEYS],
      properties: Object.fromEntries(ACTIVITY_KEYS.map((k) => [k, { type: "integer" }])),
    },
    appointment: {
      type: "object",
      additionalProperties: false,
      required: ["slot", "text"],
      properties: { slot: { type: "string", enum: ["", ...APPT_KEYS] }, text: { type: "string" } },
    },
    date: { type: "string" },
    summary: { type: "string" },
    clarification: {type:"string"},
    client_names: {type:"array",items:{type:"string"}},
    meeting:meetingJsonSchema,
    tasks: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["operation", "day", "category", "stage", "name", "plan", "status", "result", "task_id", "new_day", "time", "period"],
      properties: {
        operation: { type: "string", enum: ["create", "update", "reschedule"] }, day: { type: "string" },
        category: { type: "string", enum: ["appointment", "planning", "review", "preparation", "service"] },
        stage: { type: "string", enum: ["", "relationship", "needs", "presentation", "closing", "recruitment"] },
        task_id: {type:"string"}, new_day: {type:"string"}, time: {type:"string"},
        period: {type:"string",enum:["","morning","noon","afternoon","evening"]},
        name: { type: "string" }, plan: { type: "string" }, result: { type: "string" },
        status: { type: "string", enum: ["planned", "done", "blocked", "cancelled"] }
      }
    } },
  },
} as const;

