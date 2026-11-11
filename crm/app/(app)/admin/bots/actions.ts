"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { coachReady, coachSecret, coachToken, coachUsername, paReady, paSecret, paToken, paUserId } from "@/lib/telegram/config";
import { resolveTelegramAgent } from "@/lib/telegram/registry";
import { isCoachReady, resolveCoachToken, storeCoachToken } from "@/lib/telegram/credentials";
import { aiClient, aiModel } from "@/lib/ai-client";
import { codexMode, enqueueJob, jobId, openJob } from "@/lib/codex/jobs";
import { hkToday } from "@/lib/weeks";
import { aiFailureInfo } from "@/lib/ai-errors";

async function checkAI():Promise<{ok:boolean;message:string;needsVerification?:boolean}>{
  if(codexMode()){
    const {profile}=await requireAdmin();
    if(!process.env.CODEX_WORKER_TOKEN)return{ok:false,message:"Codex 接駁金鑰未設定，未能啟動整理。"};
    const admin=createAdminClient(),messageId=`codex-health:${profile.id}:${Math.floor(Date.now()/300000)}`,id=jobId(messageId);
    const {data,error}=await admin.from("wa_drafts").select("payload").eq("id",id).maybeSingle();
    if(error)return{ok:false,message:"暫時未能檢查 Codex 工作佇列。"};
    if(data){const job=openJob(id,data.payload);return{ok:job.state==="done",message:job.state==="done"?"Codex 整理檢查已通過。可以返 Telegram 提交資料，核對預覽後確認。":job.state==="failed"?"Codex 檢查未通過，請檢查常駐程式、登入或用量。":"檢查已排隊，等待 Codex 常駐程式回覆。稍後再按檢查；未有確認服務可用。"};}
    await enqueueJob(admin,{kind:"health",ownerId:profile.id,from:"",messageId,text:"",texts:"測試連線，冇客戶資料。請所有欄位留空。",today:hkToday(),expectedDraftId:null});
    return{ok:false,message:"Codex 檢查已排隊，等待常駐程式回覆。稍後再按檢查；未有確認服務可用。"};
  }
  try{
    await(await aiClient()).messages.create({model:aiModel(),max_tokens:64,messages:[{role:"user",content:"Reply only OK."}]});
    return{ok:true,message:"AI 整理服務已可用。可以返 Telegram 重傳原本資料，核對預覽後回覆「確認」。"};
  }catch(error){
    if(aiFailureInfo(error).verificationRequired)return{ok:false,needsVerification:true,message:"AI 整理服務未開通：Vercel 要求帳戶擁有人先完成付款卡驗證。請按下方「完成 AI 帳戶驗證」，完成後再檢查；唔需要重新綁定 Telegram 或重貼 Bot 金鑰。"};
    return{ok:false,message:"AI 整理暫時未能使用，請檢查服務設定後再試。"};
  }
}
export async function checkAIServiceAction(){
  await requireAdmin();
  return checkAI();
}

async function api(token:string, method:string, body:Record<string,unknown>={}){
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),cache:"no-store"});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error("Telegram 連線未成功");return data.result;
}
export async function registerBotsAction():Promise<{ok:boolean;message:string}>{
  await requireAdmin();
  if(!await isCoachReady()||!paReady())return{ok:false,message:"兩個 Bot 設定未齊，可以先用下方一格安全輸入金鑰，單獨啟用Ryan大佬bot。"};
  let coachConnected=false;
  try{
    if(!await resolveTelegramAgent(createAdminClient(),paUserId()))return{ok:false,message:"請先喺員工帳戶將 Ryan 嘅數字 Telegram ID 綁定佢自己嘅有效 CRM 帳戶。"};
    const token=(await resolveCoachToken())!;
    const [coach,pa]=await Promise.all([api(token,"getMe"),api(paToken()!,"getMe")]);
    if(coach.id===pa.id)return{ok:false,message:"呢兩套金鑰屬於同一個 Bot，請設定兩個獨立 Bot。"};
    if([coach.username,pa.username].some(name=>name?.toLowerCase()==="cloud_compute_bot"))return{ok:false,message:"cloud_compute_bot 係現有文件助手，請用新建嘅 Ryan PA 同Ryan大佬bot，避免中斷原有服務。"};
    const base="https://ryan-crm-chi.vercel.app";
    await api(token,"setWebhook",{url:`${base}/api/telegram`,secret_token:coachSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});coachConnected=true;
    await api(paToken()!,"setWebhook",{url:`${base}/api/telegram/pa`,secret_token:paSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});
    const [coachStatus,paStatus]=await Promise.all([api(token,"getWebhookInfo"),api(paToken()!,"getWebhookInfo")]);
    if(coachStatus.url!==`${base}/api/telegram`||paStatus.url!==`${base}/api/telegram/pa`)throw new Error();
    revalidatePath("/admin/bots");revalidatePath("/telegram");
    return{ok:true,message:`已核對兩個獨立 Bot 並接駁成功：Ryan大佬bot @${coach.username}；Ryan 私人 PA @${pa.username}。請各自私訊 /start 試用。`};
  }catch{return{ok:false,message:coachConnected?"Ryan大佬bot 已設定 webhook，但未能確認兩個 Bot 都接通。請核對 PA 金鑰後再試。":"未能接駁，請核對 Bot 金鑰同 Telegram 設定後再試。"};}
}

export async function registerCoachAction():Promise<{ok:boolean;message:string;needsVerification?:boolean}>{
  await requireAdmin();
  if(!await isCoachReady())return{ok:false,message:"Ryan大佬bot 未齊設定。可以喺呢頁安全輸入 @Ryan_main_bot 嘅 BotFather 金鑰，私人 PA 唔需要先設定。"};
  try{
    const token=(await resolveCoachToken())!;
    const coach=await api(token,"getMe");
    if(typeof coach.username!=="string" || coach.username.toLowerCase()!==(coachUsername() || "Ryan_main_bot").toLowerCase())return{ok:false,message:"呢個 token 唔屬於指定Ryan大佬bot，未有更改 webhook。請核對 @Ryan_main_bot 嘅金鑰。"};
    const url="https://ryan-crm-chi.vercel.app/api/telegram";
    await api(token,"setWebhook",{url,secret_token:coachSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});
    const status=await api(token,"getWebhookInfo");
    if(status.url!==url)throw new Error();
    revalidatePath("/admin/bots");revalidatePath("/telegram");
    const service=await checkAI();
    if(!service.ok)return{...service,message:`Ryan大佬bot 金鑰已保存，Telegram 連線已接通；${service.message}`};
    return{ok:true,message:`Ryan大佬bot @${coach.username} 已接通。請私訊 /start，將顯示嘅數字 ID 喺員工帳戶綁定，再試提交更新。私人 PA 未有更改。`};
  }catch{return{ok:false,message:"未能確認Ryan大佬bot 已接通，請檢查 token 後再試。私人 PA 未有更改。"};}
}

export async function saveCoachCredentialAction(form:FormData):Promise<{ok:boolean;message:string;needsVerification?:boolean}>{
  await requireAdmin();
  const token=String(form.get("token") || "").trim();
  if(!/^\d+:[a-zA-Z0-9_-]{20,150}$/.test(token))return{ok:false,message:"請貼入 BotFather 提供嘅完整金鑰，唔係 Bot 名稱或網址。"};
  try{
    const bot=await api(token,"getMe");
    if(bot.username?.toLowerCase()!=="ryan_main_bot")return{ok:false,message:"呢個金鑰唔屬於 @Ryan_main_bot，未有保存或改動連線。"};
    await storeCoachToken(token);
  }catch{return{ok:false,message:"未能核對或保存金鑰。請檢查有冇複製完整；金鑰內容唔會顯示喺錯誤訊息。"};}
  return registerCoachAction();
}
