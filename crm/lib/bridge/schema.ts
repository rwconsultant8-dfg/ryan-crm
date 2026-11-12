import {normalizeAge} from "../age";
import {isCustomerType} from "../customer-types";
import { z } from "zod";
import { INFO_KEYS, FORMS, CHECK_KEYS, formFieldKeys, GENDERS, MARITAL } from "../stages";
import { BridgeError } from "./auth";

import { taskMessageSchema } from "../whatsapp/tasks";
import { isDate } from "../weeks";

const plain = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(5000));
export const patchSchema = z.object({
  info: plain.optional(),
  forms: z.record(z.enum(["form_rr","form_nr1","form_nr2","form_fna","form_pc"]), plain).optional(),
  checks: z.record(z.string(), z.boolean()).optional(),
  stage: z.enum(["MEETING","FOLLOWUP","PROPOSAL","SIGNED","ISSUED"]).optional(),
  season: z.enum(["SPRING","SUMMER","AUTUMN","WINTER"]).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "修改內容唔可以留空");
export const commandSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("tasks_list"),from:z.string().refine(isDate),to:z.string().refine(isDate),owner_id:z.string().uuid().optional()}).strict(),
  z.object({action:z.literal("tasks_prepare"),tasks:z.array(taskMessageSchema.strict()).min(1).max(30)}).strict(),
  z.object({action:z.literal("tasks_confirm"),draft_id:z.string().uuid()}).strict(),
  z.object({action:z.literal("tasks_status"),draft_id:z.string().uuid()}).strict(),
  z.object({action:z.literal("tasks_cancel"),draft_id:z.string().uuid()}).strict(),
  z.object({action:z.literal("whoami")}).strict(),
  z.object({action:z.literal("schema")}).strict(),
  z.object({action:z.literal("staff")}).strict(),
  z.object({action:z.literal("list"),owner_id:z.string().uuid().optional(),offset:z.number().int().min(0).max(100000).default(0)}).strict(),
  z.object({action:z.literal("get"),id:z.string().uuid()}).strict(),
  z.object({action:z.literal("create"),operation_id:z.string().uuid(),owner_id:z.string().uuid().optional(),patch:patchSchema}).strict(),
  z.object({action:z.literal("update"),operation_id:z.string().uuid(),id:z.string().uuid(),expected_updated_at:z.string().min(10).max(40),patch:patchSchema}).strict(),
  z.object({action:z.literal("delete"),operation_id:z.string().uuid(),id:z.string().uuid(),expected_updated_at:z.string().min(10).max(40),confirmed_name:z.string().min(1).max(200)}).strict(),
]);
export type Command=z.infer<typeof commandSchema>;
export type Patch=z.infer<typeof patchSchema>;
export function validatePatch(p:Patch, creating=false) {
  const bad=()=>{throw new BridgeError(400,"欄位或內容無效");};
  if(creating && !p.info?.name?.trim()) bad();
  if(p.info) for(const [k,v] of Object.entries(p.info)) {
    if(!(INFO_KEYS as readonly string[]).includes(k)||v.length>200) bad();
    if(k==="name"&&!v.trim()) bad();
    if(k==="age"&&normalizeAge(v)===null) bad();
    if(k==="gender"&&v&&!GENDERS.some(g=>g.value===v)) bad();
    if(k==="marital"&&v&&!MARITAL.some(m=>m.value===v)) bad();
    if(k==="customer_type"&&!isCustomerType(v)) bad();
  }
  if(p.checks) for(const k of Object.keys(p.checks)) if(!(CHECK_KEYS as string[]).includes(k)) bad();
  if(p.forms) for(const [col,values] of Object.entries(p.forms)) {
    const def=FORMS.find(f=>f.column===col)!;
    for(const k of Object.keys(values)) if(!formFieldKeys(def).includes(k)) bad();
  }
}
