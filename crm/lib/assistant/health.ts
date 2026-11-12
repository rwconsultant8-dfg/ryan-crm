import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {researchProbeReport} from "./research-probe";
export const ASSISTANT_PROBE_ID='assistant-research-v4';
export const ASSISTANT_PROBE_TEXT='我想睇FWD尊衞您同埋永明嘅高端醫療保費對比';
export async function assistantProbeStatus(admin:SupabaseClient){
  try{return(await researchProbeReport(admin,ASSISTANT_PROBE_ID)).status;}catch{return'pending';}
}
