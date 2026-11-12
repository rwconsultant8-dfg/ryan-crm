"use server";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireUser} from "@/lib/auth";
import {createAdminClient} from "@/lib/supabase/admin";
import {meetingSchema} from "@/lib/meeting";
import {hkToday,isDate,addDays} from "@/lib/weeks";
import {decryptColumn} from "@/lib/secure";
import {applyDraft,type Draft} from "@/lib/whatsapp/apply";
import {prepareTasks} from "@/lib/whatsapp/tasks";
import {sealDraft,openDraft} from "@/lib/whatsapp/drafts";
export async function saveMeetingAction(input:{id:string;clientId:string;day:string;summary:string;response:string;blocker:string;needs_help:boolean;next_step:string;next_day:string}){
 const {supabase,profile}=await requireUser();
 const parsed=meetingSchema.safeParse({...input,occurred:true});if(!parsed.success||!z.string().uuid().safeParse(input.id).success||!z.string().uuid().safeParse(input.clientId).success||!isDate(input.day)||input.day>hkToday()||!input.summary.trim()||(input.next_day&&(input.next_day<hkToday()||input.next_day>addDays(hkToday(),60)||!input.next_step.trim())))return{ok:false,error:"請填寫見客摘要及有效日期；下一步日期最多60日內，未定可以留空。"};
 const {data:client,error}=await supabase.from("clients").select("id,info").eq("id",input.clientId).eq("owner_id",profile.id).maybeSingle();if(error||!client)return{ok:false,error:"只可以記錄自己負責嘅客戶。"};
 const name=decryptColumn(client.id,"info",client.info).name||"未命名客戶",admin=createAdminClient();
 let draft:Draft={channel:"app",texts:[input.summary],today:hkToday(),target:{mode:"existing",id:client.id,name},extraction:{client:{name:"",age:"",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:input.day,summary:input.summary,meeting:parsed.data,tasks:input.next_day?[{operation:"create",day:input.next_day,category:"planning",stage:"",name,plan:input.next_step,status:"planned",result:"",client_id:client.id}]:[]}};
 try{
   const {data:old,error:readError}=await admin.from("wa_drafts").select("owner_id,payload,status").eq("id",input.id).maybeSingle();if(readError)throw Error("未能核對儲存狀態。");
   if(old){if(old.owner_id!==profile.id)throw Error("記錄代號無效。");const saved=openDraft(input.id,old.payload);if(saved.channel!=="app"||(saved.target.mode!=="existing"&&saved.target.mode!=="new")||saved.target.id!==client.id||JSON.stringify(saved.extraction.meeting)!==JSON.stringify(parsed.data)||saved.extraction.date!==input.day)throw Error("上次紀錄已保存，請重新載入後再補充。");draft=saved;}
   else{if(draft.extraction.tasks?.length)draft.taskItems=await prepareTasks(admin,profile.id,draft.extraction.tasks);const {error:writeError}=await admin.from("wa_drafts").insert({id:input.id,owner_id:profile.id,status:"applied",payload:sealDraft(input.id,draft),decided_at:new Date().toISOString()});if(writeError)throw Error("未能建立見客記錄，請用同一份資料重試。");}
   await applyDraft(admin,profile.id,draft,input.id);
 }catch(e){return{ok:false,error:e instanceof Error?e.message:"未能儲存，請重試。"};}
 for(const path of ["/admin","/board","/today",`/clients/${client.id}`])revalidatePath(path);return{ok:true,error:""};
}
