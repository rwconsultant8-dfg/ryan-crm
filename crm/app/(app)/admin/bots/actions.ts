"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { coachSecret, coachUsername, paReady, paSecret, paToken, paUserId } from "@/lib/telegram/config";
import { resolveTelegramAgent } from "@/lib/telegram/registry";
import { isCoachReady, resolveCoachToken, storeCoachToken, runtimeBotsSeparate } from "@/lib/telegram/credentials";
import { codexWorkerConfigured, enqueueJob, jobId, openJob } from "@/lib/codex/jobs";
import { hkToday } from "@/lib/weeks";

export async function checkAIServiceAction(): Promise<{ok:boolean;message:string}> {
  const {profile}=await requireAdmin();
  if(!codexWorkerConfigured())return{ok:false,message:"Codex 接駁設定未齊。"};
  try {
    const admin=createAdminClient(),messageId=`codex-health:${profile.id}:${Math.floor(Date.now()/300000)}`,id=jobId(messageId);
    const {data,error}=await admin.from("wa_drafts").select("payload").eq("id",id).maybeSingle();
    if(error)throw Error("Cannot read check");
    if(data){
      const job=openJob(id,data.payload);
      if(job.state==="done")return{ok:true,message:"Codex 已回覆測試，可以返 Telegram 試用。"};
      if(job.state==="failed")return{ok:false,message:"Codex 測試未通過，請檢查常駐程式、登入或用量。"};
    } else {
      await enqueueJob(admin,{kind:"health",ownerId:profile.id,from:"",messageId,text:"",texts:"測試連線，冇客戶資料。請所有欄位留空。",today:hkToday(),expectedDraftId:null});
    }
    return{ok:false,message:"測試已排隊，等候 Codex 回覆。稍後再按檢查。"};
  } catch {
    return{ok:false,message:"暫時未能檢查 Codex 工作佇列。"};
  }
}

async function api(token:string, method:string, body:Record<string,unknown>={}){
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),cache:"no-store"});
  const data=await response.json();if(!response.ok||!data.ok)throw new Error("Telegram 連線未成功");return data.result;
}
export async function registerBotsAction():Promise<{ok:boolean;message:string}>{
  await requireAdmin();
  if(!await isCoachReady()||!paReady()||!await runtimeBotsSeparate())return{ok:false,message:"兩個 Bot 設定未齊，可以先用下方一格安全輸入金鑰，單獨啟用ZEST 團隊助手。"};
  let coachConnected=false;
  try{
    if(!await resolveTelegramAgent(createAdminClient(),paUserId()))return{ok:false,message:"請先喺員工帳戶將 Ryan 嘅數字 Telegram ID 綁定佢自己嘅有效 CRM 帳戶。"};
    const token=(await resolveCoachToken())!;
    const [coach,pa]=await Promise.all([api(token,"getMe"),api(paToken()!,"getMe")]);
    if(coach.id===pa.id)return{ok:false,message:"呢兩套金鑰屬於同一個 Bot，請設定兩個獨立 Bot。"};
    if([coach.username,pa.username].some(name=>name?.toLowerCase()==="cloud_compute_bot"))return{ok:false,message:"cloud_compute_bot 係現有文件助手，請用新建嘅 Ryan PA 同ZEST 團隊助手，避免中斷原有服務。"};
    const base="https://ryan-crm-chi.vercel.app";
    await api(token,"setWebhook",{url:`${base}/api/telegram`,secret_token:coachSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});coachConnected=true;
    await api(paToken()!,"setWebhook",{url:`${base}/api/telegram/pa`,secret_token:paSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});
    const [coachStatus,paStatus]=await Promise.all([api(token,"getWebhookInfo"),api(paToken()!,"getWebhookInfo")]);
    if(coachStatus.url!==`${base}/api/telegram`||paStatus.url!==`${base}/api/telegram/pa`)throw new Error();
    revalidatePath("/admin/bots");revalidatePath("/telegram");
    return{ok:true,message:`已核對兩個獨立 Bot 並接駁成功：ZEST 團隊助手 @${coach.username}；Ryan 私人 PA @${pa.username}。請各自私訊 /start 試用。`};
  }catch{return{ok:false,message:coachConnected?"ZEST 團隊助手 已設定 webhook，但未能確認兩個 Bot 都接通。請核對 PA 金鑰後再試。":"未能接駁，請核對 Bot 金鑰同 Telegram 設定後再試。"};}
}

export async function registerCoachAction():Promise<{ok:boolean;message:string}>{
  await requireAdmin();
  if(!await isCoachReady())return{ok:false,message:"ZEST 團隊助手 未齊設定。可以喺呢頁安全輸入 @Ryan_main_bot 嘅 BotFather 金鑰，私人 PA 唔需要先設定。"};
  try{
    const token=(await resolveCoachToken())!;
    const coach=await api(token,"getMe");
    if(typeof coach.username!=="string" || coach.username.toLowerCase()!==(coachUsername() || "Ryan_main_bot").toLowerCase())return{ok:false,message:"呢個 token 唔屬於指定ZEST 團隊助手，未有更改 webhook。請核對 @Ryan_main_bot 嘅金鑰。"};
    const url="https://ryan-crm-chi.vercel.app/api/telegram";
    await api(token,"setWebhook",{url,secret_token:coachSecret(),allowed_updates:["message"],max_connections:1,drop_pending_updates:false});
    const status=await api(token,"getWebhookInfo");
    if(status.url!==url)throw new Error();
    revalidatePath("/admin/bots");revalidatePath("/telegram");
    const service=await checkAIServiceAction();
    if(!service.ok)return{...service,message:`ZEST 團隊助手 金鑰已保存，Telegram 連線已接通；${service.message}`};
    return{ok:true,message:`ZEST 團隊助手 @${coach.username} 已接通。請私訊 /start，將顯示嘅數字 ID 喺員工帳戶綁定，再試提交更新。私人 PA 未有更改。`};
  }catch{return{ok:false,message:"未能確認ZEST 團隊助手 已接通，請檢查 token 後再試。私人 PA 未有更改。"};}
}

export async function saveCoachCredentialAction(form:FormData):Promise<{ok:boolean;message:string}>{
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
