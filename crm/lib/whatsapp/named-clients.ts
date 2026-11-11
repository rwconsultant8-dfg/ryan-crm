import "server-only";
import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {loadClientNames,matchClient} from "./apply";
import {encryptColumn,decryptColumn} from "../secure";
const norm=(name:string)=>name.replace(/\s+/g,"").toLowerCase();
function nameId(owner:string,name:string){
  const hex=createHash("sha256").update(`named-client-v1:${owner}:${norm(name)}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
/** Explicit user rule: create a name-only profile immediately; other details need preview. */
export async function ensureNamedClients(db:SupabaseClient,owner:string,names:string[]) {
  const unique=[...new Map(names.filter(n=>n.trim()).map(n=>[norm(n),n.trim()])).values()];
  if(!unique.length)return {clients:[] as {id:string;name:string}[],created:[] as string[],ambiguous:[] as string[]};
  const clients=await loadClientNames(db,owner),created:string[]=[],ambiguous:string[]=[];
  for(const name of unique){
    const target=matchClient(name,clients);
    if(target.mode==="ambiguous"){ambiguous.push(name);continue;}
    if(target.mode!=="new")continue;
    const id=nameId(owner,name);
    const {error}=await db.rpc("wa_save_client",{p_actor:owner,p_id:id,p_create:true,p_patch:{info:encryptColumn(id,"info",{},{name})}});
    if(error){
      // A concurrent/retried message can have created this same name already.
      const {data:existing,error:readError}=await db.from("clients").select("id,info").eq("id",id).eq("owner_id",owner).maybeSingle();
      if(readError || !existing || norm(decryptColumn(id,"info",existing.info).name || "")!==norm(name))throw Error("暫時未能開客戶 Profile，原文已保留，請稍後重試。");
    } else created.push(name);
    clients.push({id,name});
  }
  return {clients,created,ambiguous};
}
