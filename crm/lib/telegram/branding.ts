import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {resolveCoachToken} from "./credentials";
export const TEAM_BOT_NAME="Ryan大佬bot";
const marker="telegram-profile:Ryan_main_bot:ryan-daailou-name-v1";
/** Apply the requested display name once, through the authenticated production worker. */
export async function syncTelegramDisplayName(admin:SupabaseClient){
 if(process.env.VERCEL_ENV!=="production")return;
 const {data:done,error:readError}=await admin.from("wa_seen_messages").select("message_id").eq("message_id",marker).maybeSingle();
 if(readError)throw Error("Bot name state unavailable");
 if(done)return;
 const token=await resolveCoachToken();if(!token)throw Error("Bot unavailable");
 async function api(method:string,body:Record<string,string>={}){
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(5000),cache:"no-store"});
  const value=await response.json();if(!response.ok||value.ok!==true)throw Error("Bot name request unavailable");return value.result;
 }
 const identity=await api("getMe");
 if(identity.username?.toLowerCase()!=="ryan_main_bot"||identity.is_bot!==true)throw Error("Bot identity mismatch");
 await api("setMyName",{name:TEAM_BOT_NAME});
 const verified=await api("getMyName");if(verified.name!==TEAM_BOT_NAME)throw Error("Bot name not verified");
 const {error}=await admin.from("wa_seen_messages").insert({message_id:marker});if(error&&error.code!=="23505")throw Error("Bot name state unavailable");
 console.info("Telegram bot display name verified: Ryan大佬bot");
}
