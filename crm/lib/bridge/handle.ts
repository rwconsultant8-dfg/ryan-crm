import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { BridgeError, type Identity } from "./auth";
import { commandSchema, validatePatch, type Patch } from "./schema";
import { encryptColumn, decryptColumn } from "../secure";
import { encryptValue, parseKey } from "../crypto";
import { INFO_KEYS, FORMS, CHECK_KEYS, formFieldKeys, normalizeStage } from "../stages";

import { handleTaskCommand } from "./tasks";
import { SEASONS, seasonForStage, pipelinePatch } from "../seasons";
import { CATEGORIES, PLAN_STAGES, STATUSES } from "../planner";

type Row=Record<string,unknown> & {id:string;owner_id:string;updated_at:string};
const columns=["info",...FORMS.map(f=>f.column)];
function decode(row:Row) {
  const out:Row={...row, stage:normalizeStage(row.stage), season:seasonForStage(String(row.stage))};
  for(const col of columns) out[col]=decryptColumn(row.id,col,row[col] as Record<string,string>);
  return out;
}
function encryptedPatch(id:string, p:Patch, previous:Row|null) {
  const out:Record<string,unknown>={};
  if(p.info) out.info=encryptColumn(id,"info",previous?.info as Record<string,string>,p.info);
  for(const [col,v] of Object.entries(p.forms??{})) out[col]=encryptColumn(id,col,previous?.[col] as Record<string,string>,v);
  Object.assign(out,p.checks??{});
  try { Object.assign(out,pipelinePatch({stage:p.stage,season:p.season},String(previous?.stage || "RR"))); }
  catch(e) { throw new BridgeError(400,e instanceof Error ? e.message : "客戶進度無效"); }
  return out;
}
function databaseError(error:unknown) { if(error) throw new BridgeError(503,"CRM 儲存服務出錯；未確認完成，請先查記錄，唔好重複提交"); }
function owner(identity:Identity, requested?:string) {
  if(identity.role!=="admin" && requested && requested!==identity.id) throw new BridgeError(403,"只可以處理自己嘅客戶");
  return requested??identity.id;
}
async function load(admin:SupabaseClient, identity:Identity,id:string):Promise<Row> {
  let q=admin.from("clients").select("*").eq("id",id);
  if(identity.role!=="admin") q=q.eq("owner_id",identity.id);
  const {data,error}=await q.maybeSingle();databaseError(error);
  if(!data) throw new BridgeError(404,"搵唔到你有權處理嘅客戶");
  return data as Row;
}
export async function handleCommand(admin:SupabaseClient, identity:Identity, raw:unknown) {
  const parsed=commandSchema.safeParse(raw);
  if(!parsed.success) throw new BridgeError(400,"操作格式無效，請按 schema 提交");
  const c=parsed.data;
  const {data:profile,error:profileError}=await admin.from("profiles").select("id,full_name,role,active,whatsapp").eq("id",identity.id).maybeSingle();
  databaseError(profileError);
  if(!profile?.active || profile.role!==identity.role || (profile.whatsapp && profile.whatsapp!==identity.phone)) throw new BridgeError(403,"帳戶已停用、角色改變或號碼綁定唔一致");
  if(c.action==="tasks_list"||c.action==="tasks_prepare"||c.action==="tasks_confirm"||c.action==="tasks_cancel"||c.action==="tasks_status") return handleTaskCommand(admin,identity,c);
  if(c.action==="whoami") return {name:profile.full_name,profile_id:identity.id,role:identity.role,scope:identity.role==="admin"?"team_clients":"own_clients"};
  if(c.action==="schema") return {network_categories:SEASONS,planner:{categories:CATEGORIES,stages:PLAN_STAGES,statuses:STATUSES,write_scope:"own_tasks",flow:"tasks_prepare → show preview → explicit confirmation → tasks_confirm",commands:{tasks_list:{required:["from","to"],optional:["owner_id"],date_format:"YYYY-MM-DD",max_days:31},tasks_prepare:{required:["tasks"],max_tasks:30,task_fields:["operation","day","category","stage","name","plan","status","result"],operations:["create","update"],update_matching:"Read tasks_list first; use original day/category/name/stage/plan. Only status and result change."},tasks_confirm:{required:["draft_id"],requires:"explicit confirmation after preview"},tasks_cancel:{required:["draft_id"]},tasks_status:{required:["draft_id"],saved:"true only after a database receipt exists"}}},info:INFO_KEYS,forms:FORMS.map(f=>({column:f.column,title:f.title,fields:f.sections.flatMap(s=>s.fields),keys:formFieldKeys(f)})),checks:CHECK_KEYS,actions:["tasks_status","tasks_list","tasks_prepare","tasks_confirm","tasks_cancel","whoami","schema","list","get","create","update","delete",...(identity.role==="admin"?["staff"]:[])]};
  if(c.action==="staff") {
    if(identity.role!=="admin") throw new BridgeError(403,"只限主管");
    const {data,error}=await admin.from("profiles").select("id,full_name,role,active").order("full_name");databaseError(error);return {staff:data};
  }
  if(c.action==="list") {
    if(c.owner_id) owner(identity,c.owner_id);
    let q=admin.from("clients").select("id,owner_id,info,stage,season,updated_at,ready_to_sign").order("id").range(c.offset,c.offset+49);
    if(identity.role!=="admin"||c.owner_id) q=q.eq("owner_id",owner(identity,c.owner_id));
    const {data,error}=await q;databaseError(error);
    return {clients:(data??[]).map(r=>({...r,stage:normalizeStage(r.stage),season:seasonForStage(String(r.stage)),info:decryptColumn(r.id,"info",r.info)})),next_offset:data?.length===50?c.offset+50:null};
  }
  if(c.action==="get") return {client:decode(await load(admin,identity,c.id))};
  if(c.action!=="delete") validatePatch(c.patch,c.action==="create");
  const previous=c.action==="create"?null:await load(admin,identity,c.id);
  const targetOwner=previous?.owner_id??owner(identity,c.action==="create"?c.owner_id:undefined);
  if(c.action==="create" && targetOwner!==identity.id) {
    const {data:p,error}=await admin.from("profiles").select("id,active").eq("id",targetOwner).maybeSingle();databaseError(error);
    if(!p?.active) throw new BridgeError(400,"負責員工唔存在或已停用");
  }
  if(previous && c.action!=="create" && previous.updated_at!==c.expected_updated_at) throw new BridgeError(409,"客戶資料已改變，請重新讀取再確認");
  if(c.action==="delete" && decryptColumn(previous!.id,"info",previous!.info as Record<string,string>).name!==c.confirmed_name) throw new BridgeError(400,"刪除前必須確認客戶全名");
  const id=previous?.id??randomUUID();
  // Durable, encrypted before-image + signed actor. Unique UUID rejects replay.
  // Cancelled journals are invisible to the legacy WhatsApp pending-draft flow.
  const journal=encryptValue(parseKey(process.env.DATA_ENCRYPTION_KEY),`bridge_journal:${c.operation_id}`,JSON.stringify({version:1,actor:identity.id,phone:identity.phone,message_id:identity.messageId,action:c.action,record_id:id,previous,request:c}));
  const {error:journalError}=await admin.from("wa_drafts").insert({id:c.operation_id,owner_id:identity.id,status:"cancelled",payload:journal});
  if(journalError?.code==="23505") throw new BridgeError(409,"呢個操作已提交過；請先查客戶現況，唔好重複提交");
  databaseError(journalError);
  const {error:auditError}=await admin.from("audit_log").insert({actor_id:identity.id,action:"WHATSAPP_REQUEST",table_name:"clients",record_id:id,client_owner_id:targetOwner,changes:{operation_id:c.operation_id,operation:c.action,message_id:identity.messageId},via:"whatsapp_codex"});databaseError(auditError);
  let result;
  if(c.action==="create") {
    result=await admin.from("clients").insert({id,owner_id:targetOwner,...encryptedPatch(id,c.patch,null)}).select("id,updated_at").single();
  } else if(c.action==="update") {
    result=await admin.from("clients").update(encryptedPatch(id,c.patch,previous)).eq("id",id).eq("owner_id",targetOwner).eq("updated_at",c.expected_updated_at).select("id,updated_at").maybeSingle();
  } else {
    result=await admin.from("clients").delete().eq("id",id).eq("owner_id",targetOwner).eq("updated_at",c.expected_updated_at).select("id").maybeSingle();
  }
  databaseError(result.error);
  if(!result.data) throw new BridgeError(409,"資料已改變，今次冇寫入；請重新讀取");
  const {error:finishError}=await admin.from("wa_drafts").update({status:"applied",decided_at:new Date().toISOString()}).eq("id",c.operation_id);
  // The write is known to have succeeded even when receipt finalization fails.
  return {ok:true,action:c.action,id,operation_id:c.operation_id,updated_at:("updated_at" in result.data ? result.data.updated_at : null),receipt_recorded:!finishError};
}
