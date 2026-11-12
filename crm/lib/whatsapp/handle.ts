import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin";
import { addDays, hkToday, isDate } from "../weeks";
import { ageFromBirthDate } from "../age";
import { AiRefusal, extractFromMessage } from "./ai";
import { applyDraft, describeDraft, hasContent, loadClientNames, matchClient, type Draft } from "./apply";
import { latestPending, reopen, sealDraft, setStatus } from "./drafts";
import { decryptColumn } from "../secure";
import { prepareTasks, taskMessageSchema } from "./tasks";
import { sendText } from "./send";
import { aiFailureInfo } from "../ai-errors";
import { codexMode, enqueueJob, cancelOwnerJobs } from "../codex/jobs";
import { ensureNamedClients } from "./named-clients";
import { loadSchedulingContext } from "./scheduling-context";
import {hasClientFacts} from "./content";
import {queuedAcknowledgement} from "../telegram/progress";
import type { Extraction } from "./schema";
import { deliverCoachReply, loadCoachConversation, savedCoachReply } from "../telegram/conversation";

export type Incoming = { from: string; messageId: string; type: string; text: string; fileId?:string;fileName?:string;mimeType?:string;fileSize?:number;telegramMessageId?:number };

const HELP = `你好，我係 ZEST 團隊助手。
有問題可以直接問我；想記錄客戶資料或安排，就講客戶姓名同重點，我會幫你更新到 app。
亦可以幫你上網搵官方資料及小冊子、下載文件、OCR相片／PDF、修改PPTX文字及填PDF／XLSX表格。先傳檔案，再講想點改。
最新資料會查來源；資料唔清楚時會再問你，唔會估填。`;

const CONFIRM = /^(確認|确认|confirm|ok|yes|1)$/i;
const CANCEL = /^(取消|cancel|no|2)$/i;
const HELPCMD = /^(幫助|帮助|help|\?|？)$/i;
const MERGE_WINDOW_MS = 2 * 3600_000; // 2 小時內嘅補充訊息會併入同一份草稿

const appUrl = () =>
  process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

export async function handleIncoming(msg: Incoming): Promise<void> {
  const admin = createAdminClient();

  // Meta 會重送：同一個訊息只處理一次
  const { error: dupErr } = await admin.from("wa_seen_messages").insert({ message_id: msg.messageId });
  if (dupErr) return;

  const { data: agent } = await admin
    .from("profiles")
    .select("id, full_name, active")
    .eq("whatsapp", msg.from)
    .maybeSingle();
  if (!agent || !agent.active) {
    await sendText(msg.from, "呢個 WhatsApp 號碼未登記，或者帳戶已停用。請搵主管喺「員工帳戶」設定你嘅 WhatsApp 號碼。");
    return;
  }

  if (msg.type !== "text") {
    await sendText(msg.from, "暫時只收文字訊息 🙏 可以用手機鍵盤嘅🎤語音輸入轉做文字再 send。");
    return;
  }

  const text = msg.text.trim().slice(0, 4000);
  if (!text || HELPCMD.test(text)) {
    await sendText(msg.from, HELP);
    return;
  }

  return processIncoming(msg, agent.id, admin, sendText);
}

/** Shared extraction/preview/confirmation flow; identity is resolved by the transport. */
export async function processIncoming(
  msg: Incoming,
  ownerId: string,
  admin: ReturnType<typeof createAdminClient>,
  sendText: (to: string, text: string) => Promise<void>,
  channel: "telegram" | "whatsapp" = "whatsapp",
  resolved?: { extract: (text:string,today:string)=>Promise<Extraction>; today:string },
): Promise<void> {
  const text = msg.text.trim().slice(0, 4000);
  const deliverText=sendText;
  let profileNotice="";
  sendText=(to,body)=>deliverText(to,profileNotice ? `${profileNotice}\n\n${body}` : body);
  if (!text || HELPCMD.test(text)) return sendText(msg.from, HELP);
  if (channel === "telegram" && /^(多謝|唔該(?:晒)?|謝謝|谢谢|thanks?|thank you|好呀|收到)[!！。.🙂😊 ]*$/i.test(text)) return sendText(msg.from, "唔使客氣，有需要隨時搵我。");
  if (channel === "telegram" && /^(你好|早晨|午安|晚安|hi|hello)[!！。.🙂😊 ]*$/i.test(text)) return sendText(msg.from, "你好，有咩可以幫你？");
  const latest = await latestPending(admin, ownerId);
  const pending = latest && (latest.draft.channel ?? "whatsapp") === channel ? latest : null;

  if (CONFIRM.test(text)) {
    if (!pending) return sendText(msg.from, "好，有需要隨時同我講。");
    if(pending.draft.extraction.clarification?.trim())return sendText(msg.from,pending.draft.extraction.clarification.trim());
    if (pending.draft.target.mode === "ambiguous")
      return sendText(msg.from, `仲未知係邊個客（${pending.draft.target.candidates.join("、")}），請先講全名。`);
    if (!(await setStatus(admin, pending.id, "applied"))) return;
    try {
      await applyDraft(admin, ownerId, pending.draft, pending.id);
    } catch (e) {
      await reopen(admin, pending.id);
      console.error("Client update save failed");
      return sendText(msg.from, "今次未能完成儲存，請稍後回覆「確認」再試。");
    }
    const t = pending.draft.target;
    const link = pending.draft.extraction.tasks?.length && !pending.draft.extraction.meeting?.occurred ? `${appUrl()}/today` : t.mode === "existing" || t.mode === "new" ? `${appUrl()}/clients/${t.id}` : `${appUrl()}/activity`;
    return sendText(msg.from, `✅ 已儲存${t.mode === "existing" || t.mode === "new" ? `到「${t.name}」` : ""}。\n${link}`);
  }

  if (CANCEL.test(text)) {
    const queued=channel==="telegram" && codexMode() ? await cancelOwnerJobs(admin,ownerId) : false;
    if (pending && (await setStatus(admin, pending.id, "cancelled"))) return sendText(msg.from, "已取消今次待確認更新。");
    return sendText(msg.from, queued ? "已取消今次處理。" : "冇未確認嘅內容。");
  }

  // 新內容（或者補充上一份未確認嘅內容）
  const recent = pending && Date.now() - new Date(pending.created_at).getTime() < MERGE_WINDOW_MS ? pending : null;
  const texts = [...(recent?.draft.texts ?? []), text];
  const today = resolved?.today || hkToday();
  if (channel === "telegram" && codexMode() && !resolved) {
    try { await enqueueJob(admin, {kind:"extraction",ownerId,from:msg.from,messageId:msg.messageId,text:msg.text,texts: texts.join("\n\n"),today,expectedDraftId:pending?.id || null}); }
    catch { return sendText(msg.from,"暫時未能處理，請稍後再試。"); }
    const acknowledgement=queuedAcknowledgement(msg.text);
    if(acknowledgement)await sendText(msg.from,acknowledgement);
    return;
  }

  let extraction;
  try {
    extraction = resolved
      ? await resolved.extract(texts.join("\n\n"),today)
      : await (async () => {
        const [schedule, conversation] = await Promise.all([
          loadSchedulingContext(admin, ownerId, today),
          channel === "telegram" ? loadCoachConversation(admin, ownerId).catch(() => []) : Promise.resolve([]),
        ]);
        return extractFromMessage(texts.join("\n\n"), today, { ...schedule, latest_message: text, conversation });
      })();
  } catch (e) {
    const issue=aiFailureInfo(e);
    console.error("AI extraction failed", {status:issue.status,type:issue.type});
    if(issue.verificationRequired)return sendText(msg.from, "暫時未能回應，請搵 Ryan 幫你睇睇。");
    return sendText(
      msg.from,
      e instanceof AiRefusal ? "呢段內容未能處理，可以換個講法嗎？" : "暫時未能回應，請稍後再試。",
    );
  }
  if (extraction.response?.kind === "chat") {
    if (channel === "telegram") return deliverCoachReply(admin, ownerId, msg.from, text, extraction.response.text, deliverText);
    return sendText(msg.from, extraction.response.text || "可以講多少少，你想問邊一部分？");
  }
  const birthday = extraction.client?.birth_date?.normalize("NFKC").replace(/\s+/gu, "");
  if (birthday && texts.join("\n").normalize("NFKC").replace(/\s+/gu, "").includes(birthday)) {
    const age = ageFromBirthDate(birthday, today);
    if (age !== null) extraction.client.age = String(age);
  }
  let named;
  try {
    named=await ensureNamedClients(admin,ownerId,[...(extraction.client_names || []),extraction.client?.name || "",...(extraction.tasks || []).map(t=>t.name)]);
    if(named.ambiguous.length && !extraction.clarification)extraction.clarification=`「${named.ambiguous.join("、")}」有多個相似客戶，請講返全名。`;
    if(named.created.length && channel !== "telegram")profileNotice=`已開客戶 Profile：${named.created.join("、")}（目前只記姓名）。`;
  }catch{console.error("Customer name update unavailable");return sendText(msg.from,"暫時未能保存客戶資料，請稍後再試。");}
  if(extraction.clarification?.trim()){
    await saveDraft(admin,ownerId,{channel,texts,today,extraction,target:{mode:"none"}},recent?.id);
    return sendText(msg.from, extraction.clarification.trim());
  }
  // 日期只接受今日前後 60 日內，否則當今日
  if(extraction.meeting?.occurred && (!isDate(extraction.date)||extraction.date<addDays(today,-60)||extraction.date>today))return sendText(msg.from,"見客日期要係已發生、最近60日內嘅有效日期；請確認日期再提交。");
  if (!isDate(extraction.date) || extraction.date < addDays(today, -60) || extraction.date > addDays(today, 60)) extraction.date = today;

  const meeting=Boolean(extraction.meeting?.occurred);
  if(meeting && extraction.date>today)return sendText(msg.from,"見客日期未發生，請確認日期；未有記錄成已見客。");
  if(meeting && extraction.meeting?.next_step && extraction.meeting.next_day && !extraction.tasks?.length){
    extraction.tasks=[{operation:"create",day:extraction.meeting.next_day,category:"planning",stage:"",name:extraction.client.name,plan:extraction.meeting.next_step,status:"planned",result:""}];
  }
  const needsClient=meeting || hasClientFacts(extraction) || !extraction.tasks?.length;
  const clients=needsClient ? (named.clients.length ? named.clients : await loadClientNames(admin,ownerId)) : named.clients;
  const prevTarget=recent?.draft.target;
  const target=needsClient && extraction.client.name.trim()!==""?matchClient(extraction.client.name,clients):needsClient && prevTarget && prevTarget.mode!=="ambiguous"?prevTarget:{mode:"none" as const};
  if(target.mode==="new" && prevTarget?.mode==="new" && prevTarget.name===target.name)target.id=prevTarget.id;
  if(meeting && target.mode==="none")return sendText(msg.from,"請先講返客戶全名，我先可以將見客結果同下一步連返同一位客戶。");
  const draft:Draft={channel,texts,today,extraction,target};
  if(extraction.tasks?.length && target.mode!=="ambiguous"){
    try{
      if(extraction.tasks.some(t=>t.day<addDays(today,-60)||t.day>addDays(today,60)||(t.new_day && (t.new_day<addDays(today,-60)||t.new_day>addDays(today,60)))))return sendText(msg.from,"待辦日期要喺今日前後60日內，請確認日期再提交。");
      const selected=(meeting || hasClientFacts(extraction)) && (target.mode==="existing"||target.mode==="new")?target:null;
      const messages=extraction.tasks.map(t=>{
        if(selected && t.name.trim().toLowerCase()!==selected.name.trim().toLowerCase())throw Error("見客紀錄有唔同客戶嘅下一步，請分開提交並講返全名。");
        if(t.operation!=="create")return t;
        const linked=selected || matchClient(t.name,clients);
        if(linked.mode==="ambiguous")throw Error(`「${t.name}」有多個相似客戶，請講全名。`);
        return linked.mode==="existing"||linked.mode==="new" ? {...t,client_id:linked.id} : t;
      });
      draft.taskItems=await prepareTasks(admin,ownerId,messages,selected?.mode==="new"?{id:selected.id,name:selected.name}:undefined);
      let index=0;
      extraction.tasks=messages.map(t=>{
        if(t.operation==="reschedule")index++;
        const item=draft.taskItems![index++],original=decryptColumn(item.id,"info",item.info);
        return taskMessageSchema.parse({...t,name:original.name,plan:original.plan,...(t.operation==="reschedule"?{new_day:item.day,time:original.time || "",period:original.period || ""}:{})});
      });
    }catch(e){return sendText(msg.from,(e as Error).message);}
  }
  const details=(extraction.fields || []).some(f=>f.text.trim()) || extraction.checks?.length || extraction.stage || extraction.season || Object.entries(extraction.client || {}).some(([key,value])=>key!=="name" && Boolean(value)) || extraction.appointment?.slot || extraction.tasks?.length || meeting;
  if(!details && named.clients.length && !named.ambiguous.length){
    if(recent)await setStatus(admin,recent.id,"cancelled");
    return sendText(msg.from,"已記低客戶姓名。有新進展再同我講就得。");
  }
  if (target.mode === "ambiguous") {
    await saveDraft(admin, ownerId, draft, recent?.id);
    return sendText(msg.from, `搵到幾個相似嘅客：${target.candidates.join("、")}。請講返全名，我再幫你整理。`);
  }
  if (!hasContent(draft)) {
    return sendText(msg.from, extraction.summary || "你想我幫你記錄資料，定係解答問題？");
  }
  const id=await saveDraft(admin, ownerId, draft, recent?.id);
  if(channel==="telegram"){
    if(!await setStatus(admin,id,"applied"))return;
    try{await applyDraft(admin,ownerId,draft,id);}
    catch{await reopen(admin,id);console.error("Automatic client update incomplete");return sendText(msg.from,"今次更新未完成，請稍後回覆「確認」再試。");}
    return deliverCoachReply(admin, ownerId, msg.from, text, savedCoachReply(draft), deliverText);
  }
  await sendText(msg.from, describeDraft(draft));
}

async function saveDraft(admin: ReturnType<typeof createAdminClient>, ownerId: string, draft: Draft, replaces?: string) {
  if (replaces) await setStatus(admin, replaces, "cancelled");
  const id = randomUUID();
  const { error } = await admin.from("wa_drafts").insert({ id, owner_id: ownerId, payload: sealDraft(id, draft) });
  if (error) throw new Error(error.message);
  return id;
}

