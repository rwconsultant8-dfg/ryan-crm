import "server-only";
import { cache } from "react";
import { createAdminClient } from "../supabase/admin";
import { coachToken, coachSecret, paToken, separateBots } from "./config";
import { codexWorkerConfigured } from "../codex/jobs";
import { fileScope, listBotFiles, readBotFile, saveBotFile } from "./files";

const scope=fileScope("coach","settings");
export const resolveCoachToken=cache(async()=>{
  try{
    const admin=createAdminClient(), files=await listBotFiles(admin,scope);
    const file=files.find(f=>f.name==="coach-credentials.json");
    if(file){const saved=JSON.parse((await readBotFile(admin,scope,file.key)).body.toString());
    if(typeof saved.token==="string" && /^\d+:[a-zA-Z0-9_-]+$/.test(saved.token))return saved.token as string;}
  }catch{ /* Environment credentials remain available if storage is not configured yet. */ }
  return coachToken();
});
export const runtimeBotsSeparate=async()=>separateBots() && (!paToken() || paToken()!==await resolveCoachToken());
export const isCoachReady=async()=>Boolean(await resolveCoachToken() && coachSecret() && codexWorkerConfigured() && await runtimeBotsSeparate());
export async function storeCoachToken(token:string){
  await saveBotFile(createAdminClient(),scope,"coach-credentials.json",Buffer.from(JSON.stringify({token})),"application/json");
}
