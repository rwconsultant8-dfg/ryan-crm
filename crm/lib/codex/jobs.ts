import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptValue, decryptValue, parseKey } from "../crypto";
import type {WorkState} from "../assistant/schema";

export const codexMode = () => process.env.AI_MODE === "codex";
export function workerAuthorized(header:string|null) {
  const secret=process.env.CODEX_WORKER_TOKEN || "";
  if(secret.length<32 || !header?.startsWith("Bearer "))return false;
  const supplied=Buffer.from(header.slice(7)),expected=Buffer.from(secret);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
export type Job = {kind:"extraction"|"health";ownerId:string;from:string;messageId:string;text:string;texts:string;today:string;expectedDraftId:string|null;draftContext?:string[];telegramMessageId?:number;receivedAt?:number;quotedText?:string;retry?:boolean;work?:WorkState;probeReport?:{passed:boolean;answer:string;tools:string[]};probe?:"assistant-tools-v1"|"field-routing-v2"|"meeting-coach-v3"|"schedule-v1"|"reschedule-v1"|"conversation-v1";state?:"pending"|"running"|"done"|"failed";lease?:string;leaseUntil?:number;updated?:number};
const prefix="codex-job-v1.";
const nextRevision=(old:string|null|undefined)=>new Date(Math.max(Date.now(),old?new Date(old).getTime()+1:0)).toISOString();
const key=()=>parseKey(process.env.DATA_ENCRYPTION_KEY);
export const sealJob=(id:string,job:Job)=>`${prefix}${job.state || "pending"}.${encryptValue(key(),`codex-job:${id}`,JSON.stringify(job))}`;
export function openJob(id:string,payload:string):Job {
  const match=payload.match(/^codex-job-v1\.(pending|running|done|failed)\.(.+)$/s);
  if(!match)throw Error("Invalid Codex job");
  const job=JSON.parse(decryptValue(key(),`codex-job:${id}`,match[2])) as Job;
  if((job.state || "pending")!==match[1])throw Error("Job state mismatch");
  return job;
}
export function jobId(messageId:string) {
  let hex=createHash("sha256").update(`ryan-codex:${messageId}`).digest("hex").slice(0,32);
  hex=hex.slice(0,12)+"4"+hex.slice(13,16)+"8"+hex.slice(17);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function enqueueJob(admin:SupabaseClient,job:Job){
  const id=jobId(job.messageId),payload=sealJob(id,{...job,state:"pending",updated:Date.now()});
  const {error}=await admin.from("wa_drafts").insert({id,owner_id:job.ownerId,status:"cancelled",payload,decided_at:null});
  if(error && error.code!=="23505")throw Error("未能排隊交 Codex 整理，原文仍喺 File；客戶資料未有改動。");
  return id;
}
export async function claimJob(admin:SupabaseClient) {
  const {data,error}=await admin.from("wa_drafts").select("id,owner_id,payload,decided_at").eq("status","cancelled").or(`payload.like.${prefix}pending.%,payload.like.${prefix}running.%`).order("created_at",{ascending:true}).limit(50);
  if(error)throw Error("Cannot read Codex queue");
  for(const row of data || []) {
    const job=openJob(row.id,row.payload);
    if(job.ownerId!==row.owner_id)throw Error("Job owner mismatch");
    if(job.state==="running" && (job.leaseUntil || 0)>Date.now())continue;
    const claimed={...job,state:"running" as const,lease:randomUUID(),leaseUntil:Date.now()+10*60_000,updated:Date.now()};
    const payload=sealJob(row.id,claimed);
    const revision=nextRevision(row.decided_at);
    let update=admin.from("wa_drafts").update({payload,decided_at:revision}).eq("id",row.id).eq("status","cancelled");
    update=row.decided_at?update.eq("decided_at",row.decided_at):update.is("decided_at",null);
    const {data:won,error:claimError}=await update.select("id");
    if(claimError)throw Error("Cannot claim Codex job");
    if(won?.length===1)return {id:row.id,job:claimed,revision};
  }
  return null;
}
export async function loadClaim(admin:SupabaseClient,id:string,lease:string){
  const {data,error}=await admin.from("wa_drafts").select("owner_id,payload,decided_at").eq("id",id).eq("status","cancelled").maybeSingle();
  if(error || !data)throw Error("Job unavailable");
  const job=openJob(id,data.payload);
  if(job.ownerId!==data.owner_id || job.state!=="running" || job.lease!==lease || (job.leaseUntil || 0)<Date.now())throw Error("Job claim expired");
  return {job,revision:data.decided_at as string|null};
}
export async function finishJob(admin:SupabaseClient,id:string,oldRevision:string|null,job:Job,state:"done"|"failed") {
  let update=admin.from("wa_drafts").update({payload:sealJob(id,{...job,state,updated:Date.now()}),decided_at:nextRevision(oldRevision)}).eq("id",id).eq("status","cancelled");
  update=oldRevision?update.eq("decided_at",oldRevision):update.is("decided_at",null);
  const {data,error}=await update.select("id");
  if(error || data?.length!==1)throw Error("Job changed");
}

export async function cancelOwnerJobs(admin:SupabaseClient,ownerId:string) {
  const {data,error}=await admin.from("wa_drafts").select("id,payload,decided_at").eq("owner_id",ownerId).eq("status","cancelled").or(`payload.like.${prefix}pending.%,payload.like.${prefix}running.%`).limit(50);
  if(error)throw Error("Cannot cancel queue");
  let changed=false;
  for(const row of data || []){const job=openJob(row.id,row.payload);if(job.ownerId!==ownerId)throw Error("Job owner mismatch");await finishJob(admin,row.id,row.decided_at,job,"failed");changed=true;}
  return changed;
}
