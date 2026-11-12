import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {encryptValue,decryptValue,parseKey} from "../crypto";
import type {CoachingNote} from "./types";
export const COACH_PREFIX="coach-action-v1.";
export function sealCoaching(note:CoachingNote){return COACH_PREFIX+encryptValue(parseKey(process.env.DATA_ENCRYPTION_KEY),`coach-action:${note.id}`,JSON.stringify({...note,revision:null}));}
export function openCoaching(row:{id:string;owner_id:string;payload:string;decided_at:string|null}):CoachingNote{
 const note=JSON.parse(decryptValue(parseKey(process.env.DATA_ENCRYPTION_KEY),`coach-action:${row.id}`,row.payload.slice(COACH_PREFIX.length))) as CoachingNote;
 if(!row.payload.startsWith(COACH_PREFIX)||note.id!==row.id||note.ownerId!==row.owner_id)throw Error("跟進事項身份不符");
 return{...note,revision:row.decided_at};
}
export async function loadCoaching(db:SupabaseClient,ownerId?:string){
 const notes:CoachingNote[]=[];
 for(let offset=0;;offset+=500){let q=db.from("wa_drafts").select("id,owner_id,payload,decided_at").eq("status","cancelled").like("payload",`${COACH_PREFIX}%`).order("created_at",{ascending:false}).range(offset,offset+499);if(ownerId)q=q.eq("owner_id",ownerId);const {data,error}=await q;if(error)throw Error("未能讀取跟進事項");for(const row of data||[])notes.push(openCoaching(row));if(!data||data.length<500)return notes;}
}
