import {createHash,timingSafeEqual} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ageFromBirthDate} from "@/lib/age";
import {createAdminClient} from "@/lib/supabase/admin";
import {openJob} from "@/lib/codex/jobs";
import {openDraft} from "@/lib/whatsapp/drafts";
import {loadClientNames,matchClient,type Draft} from "@/lib/whatsapp/apply";
import {readContactHistory} from "@/lib/followups";
import {decryptColumn,encryptColumn} from "@/lib/secure";
import {listBotFiles,readBotFile,fileScope} from "@/lib/telegram/files";
import {resolveTelegramAgent} from "@/lib/telegram/registry";
import {isClientNote} from "@/lib/assistant/schema";
import {extractionSchema} from "@/lib/whatsapp/schema";
import {processIncoming} from "@/lib/whatsapp/handle";
import {addDays,isDate} from "@/lib/weeks";

export const dynamic = "force-dynamic";
const configSchema = z.object({owner:z.string().uuid(),day:z.string().refine(isDate),tokenHash:z.string().regex(/^[a-f0-9]{64}$/)});
type Config = z.infer<typeof configSchema>;
const actionSchema = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("age"),id:z.string().length(64),client:z.string().uuid(),birthDate:z.string().max(40)}),
  z.object({operation:z.literal("apply"),id:z.string().length(64),extraction:extractionSchema}),
]);
const sha = (value:string) => createHash("sha256").update(value).digest("hex");
const compact = (text:string) => text.normalize("NFKC").replace(/\s+/gu,"").toLowerCase();
const reply = (body:unknown,status=200) => NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});

function authorized(request:NextRequest): Config | null {
  const raw = process.env.ZEST_DAY_RECONCILIATION;
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!raw || !token) return null;
  const config = configSchema.parse(JSON.parse(raw));
  const deadline = Date.parse(`${addDays(config.day,1)}T00:00:00+08:00`);
  return Date.now()<deadline && timingSafeEqual(Buffer.from(sha(token),"hex"),Buffer.from(config.tokenHash,"hex")) ? config : null;
}

type Source = {id:string;text:string;at:string;pending:boolean;telegram?:string};
type Applied = {id:string;draft:Draft;meeting:boolean};
const looksLikeMeeting = (text:string) => isClientNote(text) ||
  (text.length>=35 && /見客|見面|見咗|傾過|見左|見咗|琴日|噚日|已經同佢講|fact.finding/i.test(text));
const shortDatePattern = /(?:\d{4}|\d{2})年\s*\d{1,2}月\s*\d{1,2}[日號]|\d{4}[-/]\d{1,2}[-/]\d{1,2}/gu;
function statedBirthDate(text:string, name:string) {
  const header = text.split(/琴日|噚日|尋日|今日見|昨日/)[0].slice(0,150);
  const original = /出生|生於|出世|生日/.test(header) || compact(header).startsWith(compact(name)) ? header : "";
  const dates = [...original.matchAll(shortDatePattern)].map((match)=>match[0]);
  return dates.length === 1 ? dates[0] : null;
}

async function collect(db:SupabaseClient,config:Config) {
  const start = new Date(`${config.day}T00:00:00+08:00`).toISOString();
  const end = new Date(`${addDays(config.day,1)}T00:00:00+08:00`).toISOString();
  const {data:rows,error} = await db.from("wa_drafts").select("id,status,payload,created_at").eq("owner_id",config.owner)
    .gte("created_at",start).lt("created_at",end).order("created_at").limit(1000);
  if (error || !rows || rows.length===1000) throw Error("Incomplete draft read");
  const jobs = rows.filter(row=>row.payload.startsWith("codex-job-v1.")).map(row=>({job:openJob(row.id,row.payload),at:row.created_at}));
  const sources = new Map<string,Source>();
  for (const {job,at} of jobs) {
    if (job.ownerId!==config.owner || job.kind!=="extraction" || !/^telegram:\d+$/.test(job.messageId) || job.work) continue;
    const text = job.text.trim().slice(0,4000);
    const id = sha(compact(text));
    if (!text) continue;
    const stillRunning = (entry:typeof job) => entry.state==="pending" || entry.state==="running";
    const pending = stillRunning(job) || jobs.some(({job:followup})=>followup.work?.rootMessageId===job.messageId&&stillRunning(followup));
    const prior=sources.get(id);
    sources.set(id,{id,text,at:prior?.at??at,pending:pending||Boolean(prior?.pending),telegram:job.from});
  }

  const scope=fileScope("coach",config.owner);
  const messages: {key:string;at:string}[]=[];
  for(let offset=0;;offset+=50){
    const files=await listBotFiles(db,scope,offset);
    for(const file of files) {
      if(file.name.startsWith("訊息-") && file.created_at && file.created_at>=start && file.created_at<end)
        messages.push({key:file.key,at:file.created_at});
    }
    if(files.length<50 || files.some(file=>file.created_at && file.created_at<start))break;
    if(offset>=950)throw Error("Incomplete private message read");
  }
  const archived=await Promise.all(messages.map(async file=>({
    at:file.at, text:(await readBotFile(db,scope,file.key)).body.toString("utf8").trim().slice(0,4000),
  })));
  for(const {text,at} of archived){
    const id=sha(compact(text));
    if(text&&!sources.has(id))sources.set(id,{id,text,at,pending:Date.now()-Date.parse(at)<10*60_000});
  }

  const drafts=rows.filter(row=>row.status==="applied"&&!/^(codex-job-v1|coach-action-v1)\./.test(row.payload))
    .map(row=>({id:row.id,draft:openDraft(row.id,row.payload)}))
    .filter(row=>row.draft.channel==="telegram");
  const linked=new Set(drafts.flatMap(({draft})=>draft.target.mode==="existing"||draft.target.mode==="new"?[draft.target.id]:[]));
  const contacts=new Map<string,ReturnType<typeof readContactHistory>>();
  if(linked.size){
    const {data,error}=await db.from("clients").select("id,info").eq("owner_id",config.owner).in("id",[...linked]);
    if(error)throw Error("Could not verify written client records");
    for(const row of data??[])contacts.set(row.id,readContactHistory(decryptColumn(row.id,"info",row.info).contact_history));
  }
  const applied:Applied[]=drafts.map(({id,draft})=>({
    id,draft,meeting:(draft.target.mode==="existing"||draft.target.mode==="new")
      && Boolean(contacts.get(draft.target.id)?.some(event=>event.id===id&&event.kind==="contact")),
  }));
  return {sources:[...sources.values()].sort((a,b)=>a.at.localeCompare(b.at)),applied,messages:messages.length};
}
const includesSource=(row:Applied,source:Source)=>row.draft.texts.some(text=>compact(text)===compact(source.text));

export async function GET(request:NextRequest) {
  const config=authorized(request);
  if(!config)return reply({status:"unauthorized"},401);
  try {
    const {sources,applied,messages}=await collect(createAdminClient(),config);
    const verified=applied.filter(row=>row.meeting).flatMap(row=>{
      const {target}=row.draft;
      if(target.mode!=="existing"&&target.mode!=="new")return [];
      const related=sources.filter(source=>includesSource(row,source));
      return [{
        name:target.name,client:target.id,
        sources:related.map(({id,at})=>({id,at})),
        ages:related.flatMap(source=>{
          const birthDate=statedBirthDate(source.text,target.name);
          const age=birthDate?ageFromBirthDate(birthDate,config.day):null;
          return age===null?[]:[{source:source.id,birthDate,age}];
        }),
      }];
    });
    const unverified=sources.filter(source=>looksLikeMeeting(source.text)&&!applied.some(row=>row.meeting&&includesSource(row,source)));
    return reply({status:"ok",distinctMessages:sources.length,archivedMessages:messages,verified,unverified:unverified.map(({id,text,at,pending})=>({id,text,at,pending}))});
  } catch {
    console.error("Day reconciliation audit incomplete");
    return reply({status:"audit_unavailable"},503);
  }
}

export async function POST(request:NextRequest) {
  const config=authorized(request);
  if(!config)return reply({status:"unauthorized"},401);
  const parsed=actionSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return reply({status:"invalid_action"},400);
  const action=parsed.data,db=createAdminClient();
  try {
    const {sources,applied}=await collect(db,config);
    const source=sources.find(entry=>entry.id===action.id);
    if(!source)return reply({status:"source_not_found"},404);
    if(action.operation==="age"){
      const record=applied.find(row=>row.meeting&&includesSource(row,source)&&
        (row.draft.target.mode==="existing"||row.draft.target.mode==="new")&&row.draft.target.id===action.client);
      const target=record?.draft.target;
      if(!target||(target.mode!=="existing"&&target.mode!=="new")||statedBirthDate(source.text,target.name)!==action.birthDate)
        return reply({status:"birthday_not_verified"},409);
      const age=ageFromBirthDate(action.birthDate,config.day);
      if(age===null)return reply({status:"birthday_ambiguous"},409);
      const client=await db.from("clients").select("info,updated_at").eq("id",action.client).eq("owner_id",config.owner).single();
      if(client.error||!client.data)throw Error("Could not verify client ownership");
      if(decryptColumn(action.client,"info",client.data.info).age===String(age))return reply({status:"verified",age});
      const patch=encryptColumn(action.client,"info",client.data.info,{age:String(age)});
      const saved=await db.from("clients").update({info:patch}).eq("id",action.client).eq("owner_id",config.owner).eq("updated_at",client.data.updated_at).select("info").single();
      if(saved.error||decryptColumn(action.client,"info",saved.data?.info).age!==String(age))throw Error("Age write not verified");
      return reply({status:"verified",age});
    }

    if(applied.some(row=>row.meeting&&includesSource(row,source)))return reply({status:"already_saved"});
    if(source.pending||!source.telegram||!looksLikeMeeting(source.text))return reply({status:"source_not_ready"},409);
    const agent=await resolveTelegramAgent(db,source.telegram);
    if(agent?.id!==config.owner)return reply({status:"binding_changed"},409);
    const e=action.extraction,name=e.client.name.trim(),key=compact(name);
    if(!name||!compact(source.text).includes(key)||!e.meeting?.occurred||e.response?.kind!=="update"||e.clarification||
       e.checks.length||e.stage||e.season||[...(e.client_names??[]),...(e.tasks??[]).map(task=>task.name)].some(other=>compact(other)!==key))
      return reply({status:"review_not_verified"},409);
    const clients=(await loadClientNames(db,config.owner)).filter(client=>client.name.trim());
    const match=matchClient(name,clients);
    if(match.mode==="ambiguous"||(match.mode==="existing"&&compact(match.name)!==key))
      return reply({status:"client_ambiguous"},409);

    const marker="telegram-day-reconciliation:"+config.owner+":"+source.id;
    const claim=await db.from("wa_seen_messages").insert({message_id:marker});
    if(claim.error?.code==="23505")return reply({status:"review_already_attempted"},409);
    if(claim.error)throw Error("Could not reserve original source");
    await processIncoming({from:source.telegram,messageId:marker,type:"text",text:source.text},config.owner,db,async()=>{},"telegram",
      {today:config.day,standalone:true,extract:async()=>e});
    const verified=(await collect(db,config)).applied.find(row=>row.meeting&&includesSource(row,source));
    const target=verified?.draft.target;
    return target&&(target.mode==="existing"||target.mode==="new")?
      reply({status:"verified",client:target.id}):reply({status:"write_not_verified"},503);
  } catch {
    console.error("Day reconciliation could not complete");
    return reply({status:"operation_unavailable"},503);
  }
}
