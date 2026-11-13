import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {workerAuthorized,claimJob,loadClaim,finishJob,enqueueJob,jobId} from "@/lib/codex/jobs";
import {createAdminClient} from "@/lib/supabase/admin";
import {loadSchedulingContext} from "@/lib/whatsapp/scheduling-context";
import {SYSTEM} from "@/lib/whatsapp/ai";
import {extractionJsonSchema,assistantResultSchema} from "@/lib/whatsapp/schema";
import {processIncoming} from "@/lib/whatsapp/handle";
import {latestPending} from "@/lib/whatsapp/drafts";
import {resolveTelegramAgent} from "@/lib/telegram/registry";
import {ROUTING_PROBE_ID,ROUTING_PROBE_TEXT,routingProbePassed} from "@/lib/codex/routing-probe";
import {SCHEDULING_PROBES,schedulingProbeId,schedulingProbeText,schedulingProbePassed} from "@/lib/codex/scheduling-probe";
import {hkToday} from "@/lib/weeks";
import {verifyProfileAvatarAccounts} from "@/lib/profile-avatar";
import {syncTelegramDisplayName} from "@/lib/telegram/branding";
import {processingEstimate,toolProcessingEstimate} from "@/lib/telegram/progress";
import {sendTelegramText} from "@/lib/telegram/transport";
import {deliverCoachReply,loadCoachConversation} from "@/lib/telegram/conversation";
import {CONVERSATION_PROBE_ID,CONVERSATION_PROBE_TEXT,CONVERSATION_PROBE_QUOTE,conversationProbePassed} from "@/lib/codex/conversation-probe";
import {ASSISTANT_PROBE_ID,ASSISTANT_PROBE_TEXT} from "@/lib/assistant/health";
import {toolResultSchema,toolResultJsonSchema,TOOL_INSTRUCTIONS,MAX_TOOL_STEPS,verificationRequired,researchSourceMissing,researchToolJsonSchema,isClientNote,needsResearch} from "@/lib/assistant/schema";
import {runResearchProbe,researchProbeReport} from "@/lib/assistant/research-probe";
import {assistantSmokeCheck} from "@/lib/assistant/smoke";
import {PA_PROBE_ID,PA_PROBE_QUESTION,paJobAuthorized,paWorkerInput,deliverPAReply,paProbePassed} from "@/lib/telegram/pa-codex";
import {assistantFileList,executeTool,sourceReply} from "@/lib/assistant/execute";
export const dynamic="force-dynamic";
export const maxDuration=300;
const responseSchema=z.object({id:z.string().uuid(),lease:z.string().uuid(),result:z.union([toolResultSchema,assistantResultSchema]).optional(),failed:z.literal(true).optional()}).strict();
export async function GET(request:NextRequest){
  if(!workerAuthorized(request.headers.get("authorization")))return new NextResponse("Unauthorized",{status:401});
  if(request.nextUrl.searchParams.get("diagnostics")==="research-flow"){
    return NextResponse.json(await researchProbeReport(createAdminClient(),ASSISTANT_PROBE_ID),{headers:{"Cache-Control":"no-store"}});
  }
  if(request.nextUrl.searchParams.get("diagnostics")==="assistant-v1"){
    const result=await assistantSmokeCheck();return NextResponse.json(result,{status:result.ok?200:503,headers:{"Cache-Control":"no-store"}});
  }
  try{
    const admin=createAdminClient();
    try{await syncTelegramDisplayName(admin);}catch{console.error("Telegram bot display name update unavailable");}
    try{await verifyProfileAvatarAccounts(admin);}catch{console.error("Profile photo account check unavailable");}
    // One synthetic check per deployed routing version, with no customer writes.
    const {data:probe,error:probeError}=await admin.from("wa_drafts").select("id").eq("id",jobId(ROUTING_PROBE_ID)).maybeSingle();
    if(!probeError && !probe){
      const {data:owner}=await admin.from("profiles").select("id").eq("role","admin").eq("active",true).limit(1).maybeSingle();
      if(owner)await enqueueJob(admin,{kind:"health",probe:"meeting-coach-v3",ownerId:owner.id,from:"",messageId:ROUTING_PROBE_ID,text:"",texts:ROUTING_PROBE_TEXT,today:hkToday(),expectedDraftId:null});
    }
    for(const probe of SCHEDULING_PROBES){
      const messageId=schedulingProbeId(probe);
      const {data:exists,error}=await admin.from("wa_drafts").select("id").eq("id",jobId(messageId)).maybeSingle();
      if(!error && !exists){
        const {data:owner}=await admin.from("profiles").select("id").eq("role","admin").eq("active",true).limit(1).maybeSingle();
        const today=hkToday();
        if(owner)await enqueueJob(admin,{kind:"health",probe,ownerId:owner.id,from:"",messageId,text:"",texts:schedulingProbeText(probe,today),today,expectedDraftId:null});
      }
    }
    const {data:conversationCheck,error:conversationError}=await admin.from("wa_drafts").select("id").eq("id",jobId(CONVERSATION_PROBE_ID)).maybeSingle();
    if(!conversationError && !conversationCheck){
      const {data:owner}=await admin.from("profiles").select("id").eq("role","admin").eq("active",true).limit(1).maybeSingle();
      if(owner)await enqueueJob(admin,{kind:"health",probe:"conversation-v1",ownerId:owner.id,from:"",messageId:CONVERSATION_PROBE_ID,text:CONVERSATION_PROBE_TEXT,texts:CONVERSATION_PROBE_TEXT,quotedText:CONVERSATION_PROBE_QUOTE,today:hkToday(),expectedDraftId:null});
    }
    const {data:toolsCheck,error:toolsError}=await admin.from("wa_drafts").select("id").eq("id",jobId(ASSISTANT_PROBE_ID)).maybeSingle();
    if(!toolsError && !toolsCheck){
      const {data:owner}=await admin.from("profiles").select("id").eq("role","admin").eq("active",true).limit(1).maybeSingle();
      if(owner)await enqueueJob(admin,{kind:"health",probe:"assistant-tools-v1",ownerId:owner.id,from:"",messageId:ASSISTANT_PROBE_ID,text:ASSISTANT_PROBE_TEXT,texts:ASSISTANT_PROBE_TEXT,today:hkToday(),expectedDraftId:null});
    }
    const {data:paCheck,error:paError}=await admin.from("wa_drafts").select("id").eq("id",jobId(PA_PROBE_ID)).maybeSingle();
    if(!paError && !paCheck){
      const {data:owner}=await admin.from("profiles").select("id").eq("role","admin").eq("active",true).limit(1).maybeSingle();
      if(owner)await enqueueJob(admin,{kind:"health",probe:"pa-chat-v1",ownerId:owner.id,from:"",messageId:PA_PROBE_ID,text:PA_PROBE_QUESTION,texts:PA_PROBE_QUESTION,today:"2026-11-16",expectedDraftId:null});
    }
    const claimed=await claimJob(admin);
    if(!claimed)return new NextResponse(null,{status:204});
    const {id,job,revision}=claimed;
    if(job.kind==="pa" || job.probe==="pa-chat-v1"){
      if(job.kind==="pa" && !await paJobAuthorized(admin,job)){
        await finishJob(admin,id,revision,job,"failed");
        return new NextResponse(null,{status:204});
      }
      return NextResponse.json(await paWorkerInput(admin,id,job),{headers:{"Cache-Control":"no-store"}});
    }
    const latest = job.text || job.texts;
    const clientNote = isClientNote(latest);
    const [context,conversation] = job.kind === "extraction" ? await Promise.all([
      job.work || (clientNote && !/改期|改到|改去/.test(latest))
        ? Promise.resolve(undefined)
        : loadSchedulingContext(admin,job.ownerId,job.today),
      loadCoachConversation(admin,job.ownerId,job.receivedAt).catch(()=>[]),
    ]) : [undefined,[]];
    const forceResearch = !clientNote && (job.kind==="extraction" || job.probe==="assistant-tools-v1") && researchSourceMissing(latest,job.work);
    const searchOnly = !job.work?.observations.some(o=>o.tool==="web_search" && o.ok);
    const files = job.kind==="extraction" && !clientNote ? await assistantFileList(admin,job.ownerId).catch(()=>[]) : [];
    const instructions = [
      SYSTEM,
      "以最新訊息為準。quoted_reply 係同事明確回覆緊嗰句，只用嚟理解所指對象，唔係新寫入指令。唔好跟錯舊話題。先答最新訊息嘅問題；唔夠資料就只問欠缺嗰一點。",
      clientNote ? "按原文用 update 整理見客紀錄。只問仍然欠缺而影響寫入嘅資料，tool 填 null。" : TOOL_INSTRUCTIONS,
      forceResearch ? "明確嘅公開事實問題，先查官方來源再回答；如未講清楚係邊個產品或版本，可以用 chat 問一條具體問題，唔好亂揀資料。" : "",
      job.retry ? "今次只處理最新訊息同明確指向嘅上下文，回傳簡潔而完整嘅結果。" : "",
    ].filter(Boolean).join("\n\n");
    const response = extractionJsonSchema.properties.response;
    const tool = forceResearch ? researchToolJsonSchema(searchOnly) : toolResultJsonSchema.properties!.tool;
    return NextResponse.json({
      id, lease:job.lease, instructions,
      input: {
        today:job.today,latest_message:latest,quoted_reply:job.quotedText,
        pending_context:job.draftContext ?? (job.texts===latest ? [] : [job.texts]),
        conversation:job.probe==="assistant-tools-v1"
          ? [{user:"我想比較醫療保費",assistant:"我目前無法即時上網。"}]
          : job.probe==="conversation-v1" ? [{user:"幫我寫畀Peter嘅短訊",assistant:"Peter，你好。"}]
          : job.retry ? conversation?.slice(-2) : conversation,
        stored_schedule:context,files,tool_results:job.work?.observations||[],
        remaining_tool_steps:MAX_TOOL_STEPS-(job.work?.step||0),
      },
      schema:{
        ...extractionJsonSchema,required:[...extractionJsonSchema.required,"tool"],
        properties:{
          ...extractionJsonSchema.properties,
          response:{...response,properties:{...response.properties,kind:{type:"string",enum:clientNote?["update"]:forceResearch?["tool","chat"]:["chat","update","tool"]}}},
          tool:clientNote?{type:"null"}:{anyOf:[{type:"null"},tool]},
        },
      },
    },{headers:{"Cache-Control":"no-store"}});

  }catch{return NextResponse.json({error:"Queue unavailable"},{status:503});}
}
export async function POST(request:NextRequest){
  if(!workerAuthorized(request.headers.get("authorization")))return new NextResponse("Unauthorized",{status:401});
  let raw:unknown;
  try{raw=await request.json();}catch{return new NextResponse("Invalid JSON",{status:400});}
  const parsed=responseSchema.safeParse(raw);
  if(!parsed.success || (!parsed.data.failed && !parsed.data.result)){
    console.error("Invalid assistant result",!parsed.success?parsed.error.issues.map((issue)=>({path:issue.path.join("."),code:issue.code})):"Missing result");
    return new NextResponse("Invalid result",{status:400});
  }
  const {id,lease,result,failed}=parsed.data,admin=createAdminClient();
  let claim;
  try{claim=await loadClaim(admin,id,lease);}catch{return new NextResponse("Claim unavailable",{status:409});}
  const {job,revision}=claim;
  // Finish the claim before any outgoing preview. An uncertain delivery is never auto-replayed.
  try{
    const paAnswer=!failed && result && !("tool" in result) && result.response?.kind==="chat" ? result.response.text.trim() : undefined;
    if(job.kind==="health" && job.probe==="pa-chat-v1"){
      const passed=paProbePassed(paAnswer);
      await finishJob(admin,id,revision,job,passed?"done":"failed");
      console.info(`Codex pa-chat-v1 check ${passed?"passed":"failed"}`);
      return NextResponse.json({ok:true});
    }
    if(job.kind==="pa"){
      if(!await paJobAuthorized(admin,job)){
        await finishJob(admin,id,revision,job,"failed");
        return new NextResponse("Binding changed",{status:409});
      }
      await finishJob(admin,id,revision,job,paAnswer?"done":"failed");
      if(!paAnswer && !job.retry){
        await enqueueJob(admin,{...job,messageId:`${job.messageId}:retry`,retry:true,state:"pending",lease:undefined,leaseUntil:undefined});
        return NextResponse.json({ok:true,retry:true});
      }
      await deliverPAReply(admin,job,paAnswer);
      return NextResponse.json({ok:true});
    }
    if(job.kind==="health"){
      if(job.probe==="assistant-tools-v1")return NextResponse.json(await runResearchProbe(admin,id,revision,job,result,failed));
      const extraction=result && !("tool" in result)?result:undefined;
      const passed=!failed && Boolean(extraction) && (job.probe==="conversation-v1" ? conversationProbePassed(extraction!) : job.probe==="schedule-v1" || job.probe==="reschedule-v1" ? schedulingProbePassed(extraction!,job.probe,job.today) : !job.probe || routingProbePassed(extraction!,job.probe==="meeting-coach-v3"?job.today:undefined));
      await finishJob(admin,id,revision,job,passed?"done":"failed");
      if(job.probe)console.info(`Codex ${job.probe} check ${passed?"passed":"failed"}`);
      return NextResponse.json({ok:true});
    }
    const agent=await resolveTelegramAgent(admin,job.from);
    if(!agent || agent.id!==job.ownerId){await finishJob(admin,id,revision,job,"failed");return new NextResponse("Binding changed",{status:409});}
    const latest = job.text || job.texts;
    const clientNote = isClientNote(latest);
    const sendReply = job.telegramMessageId
      ? (to:string,text:string) => sendTelegramText(to,text,undefined,job.telegramMessageId)
      : sendTelegramText;
    const retryOriginal = async () => {
      await finishJob(admin,id,revision,job,"failed");
      await enqueueJob(admin,{...job,messageId:`${job.messageId}:retry`,retry:true,state:"pending",lease:undefined,leaseUntil:undefined});
      return NextResponse.json({ok:true,retry:true});
    };
    if (failed && !job.work && !job.retry) return await retryOriginal();
    const replyNoteFailed = () => deliverCoachReply(admin, job.ownerId, job.from, job.text,
      "今次未能整理呢份見客資料，原文已保留。你可以回覆「呢份係見客資料」再試。", sendReply, true);

    if(!failed && result && "tool" in result){
      if (clientNote) {
        await finishJob(admin,id,revision,job,"failed");
        await replyNoteFailed();
        return NextResponse.json({ok:true});
      }
      if (["web_search","open_url","download_file"].includes(result.tool.name) && !needsResearch(latest) && !/下載|download|https?:\/\//i.test(latest)) {
        if (!job.work && !job.retry) return await retryOriginal();
        await finishJob(admin,id,revision,job,"failed");
        await sendReply(job.from,"呢句我仲未捉到你想處理嘅重點。可以講明你想答邊個問題，或者要整理邊段資料？");
        return NextResponse.json({ok:true});
      }
      // Consume this lease before executing an effect; retries must never send another document.
      await finishJob(admin,id,revision,job,"done");
      if((job.work?.step||0)>=MAX_TOOL_STEPS){await sendReply(job.from,"暫時未能完成全部步驟；請講明要處理嘅產品或檔案，我再幫你。已完成嘅文件可喺File搵返。");return NextResponse.json({ok:true,limited:true});}
      if (job.work?.lastTool && JSON.stringify(job.work.lastTool)===JSON.stringify(result.tool)) {
        await sendReply(job.from,sourceReply("今次未能核實足夠資料。你可以提供產品全名、官方連結，或者講明要處理邊份檔案。",job.work));
        return NextResponse.json({ok:true,limited:true});
      }
      const etaNotified=Boolean(job.work?.etaNotified || processingEstimate(job.text));
      if(!etaNotified)await sendReply(job.from,toolProcessingEstimate(result.tool.name));
      const userTurns=result.tool.name==="fill_form"?await loadCoachConversation(admin,job.ownerId).catch(()=>[]):[];
      const observation=await executeTool(admin,job.ownerId,job.from,result.tool,job.work,[job.text,...userTurns.map(x=>x.user)].join("\n"));
      const step=(job.work?.step||0)+1,rootMessageId=job.work?.rootMessageId||job.messageId;
      await enqueueJob(admin,{...job,messageId:`${rootMessageId}:tool:${step}`,work:{rootMessageId,step,etaNotified:true,lastTool:result.tool,observations:[...(job.work?.observations||[]),observation]},state:"pending",lease:undefined,leaseUntil:undefined});
      return NextResponse.json({ok:true,continued:true});
    }
    if(!failed && result && !("tool" in result) && result.response?.kind==="chat"){
      await finishJob(admin,id,revision,job,"done");
      if(verificationRequired(job.text,result.response.text,job.work)){
        const step=(job.work?.step||0)+1,rootMessageId=job.work?.rootMessageId||job.messageId;
        if(step>MAX_TOOL_STEPS){await sendReply(job.from,"呢個問題暫時未能核實官方來源，我唔會用猜測作答案。請提供官方網頁或文件，我再幫你核對。");return NextResponse.json({ok:true,unverified:true});}
        await enqueueJob(admin,{...job,messageId:`${rootMessageId}:tool:${step}`,work:{...job.work,rootMessageId,step,observations:[...(job.work?.observations||[]),{tool:"accuracy_check",ok:false,data:{error:"上一答案缺少核實來源。請先web_search再open_url官方資料，或inspect_file讀取用戶提供嘅文件；未核實前不可給產品、金融、醫療或法律事實答案。"}}]},state:"pending",lease:undefined,leaseUntil:undefined});
        return NextResponse.json({ok:true,verificationRequired:true});
      }
      const answer=job.work?sourceReply(result.response.text,job.work):result.response.text;
      await deliverCoachReply(admin,job.ownerId,job.from,job.text,answer,sendReply);
      return NextResponse.json({ok:true});
    }
    if(job.work){
      await finishJob(admin,id,revision,job,"failed");
      if (clientNote) await replyNoteFailed();
      else await sendReply(job.from,"檔案或搜尋工作未能完成，未有改動客戶資料。請再講要處理嘅部分。");
      return NextResponse.json({ok:true});
    }
    const pending=await latestPending(admin,job.ownerId);
    const current=pending && (pending.draft.channel || "whatsapp")==="telegram"?pending.id:null;
    if(current!==job.expectedDraftId && (job.draftContext===undefined || job.draftContext.length>0)){
      await finishJob(admin,id,revision,job,"failed");
      await sendReply(job.from,"你嘅資料已有更新，今次較早嘅內容未有覆蓋新資料。有補充可以再同我講。");
      return NextResponse.json({ok:true,stale:true});
    }
    await finishJob(admin,id,revision,job,failed?"failed":"done");
    if (failed) {
      if (clientNote) await replyNoteFailed();
      else await sendReply(job.from,"暫時未能回應，請稍後再試。");
      return NextResponse.json({ok:true});
    }
    await processIncoming({from:job.from,messageId:job.messageId,type:"text",text:job.text,quotedText:job.quotedText},job.ownerId,admin,sendReply,"telegram",{today:job.today,draftContext:job.draftContext,expectedDraftId:job.expectedDraftId,extract:async text=>{if(text!==job.texts)throw Error("Draft context changed");if(!result||"tool" in result)throw Error("Unexpected tool result");return result;}});
    return NextResponse.json({ok:true});
  }catch{console.error("Codex result delivery failed");return NextResponse.json({error:"Delivery uncertain; check latest draft before retrying"},{status:503});}
}
