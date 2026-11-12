"use server";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireAdmin,requireUser,displayName} from "@/lib/auth";
import {createAdminClient} from "@/lib/supabase/admin";
import {sealCoaching,openCoaching} from "@/lib/coaching/store";
import type {CoachingNote} from "@/lib/coaching/types";
import {hkToday,isDate} from "@/lib/weeks";
const uuid=z.string().uuid();
function refresh(id:string){for(const p of ["/admin","/board","/today",`/clients/${id}`])revalidatePath(p);}
async function audit(actor:string,owner:string,client:string,id:string,status:string){const {error}=await createAdminClient().from("audit_log").insert({actor_id:actor,client_owner_id:owner,record_id:client,table_name:"wa_drafts",action:"COACH_ACTION",changes:{coaching_id:id,status},via:"app"});if(error)console.error("Coaching audit unavailable");}
export async function createCoachingAction(input:{id:string;clientId:string;request:string;dueDay:string}){
 const {supabase,profile}=await requireAdmin();
 if(!uuid.safeParse(input.id).success||!uuid.safeParse(input.clientId).success||!input.request.trim()||input.request.length>1500||(input.dueDay&&(!isDate(input.dueDay)||input.dueDay<hkToday())))return{ok:false,error:"請填寫指示及有效期限。"};
 const {data:client,error}=await supabase.from("clients").select("id,owner_id").eq("id",input.clientId).maybeSingle();if(error||!client)return{ok:false,error:"搵唔到有權查看嘅客戶。"};
 const {data:owner}=await supabase.from("profiles").select("active").eq("id",client.owner_id).maybeSingle();if(!owner?.active)return{ok:false,error:"負責同事已停用，請先處理帳戶。"};
 const note:CoachingNote={id:input.id,clientId:client.id,ownerId:client.owner_id,authorId:profile.id,authorName:displayName(profile),createdAt:new Date().toISOString(),request:input.request.trim(),dueDay:input.dueDay,status:"open",reply:"",revision:null};
 const admin=createAdminClient();const {error:insertError}=await admin.from("wa_drafts").insert({id:note.id,owner_id:note.ownerId,status:"cancelled",payload:sealCoaching(note),decided_at:null});
 if(insertError){if(insertError.code!=="23505")return{ok:false,error:"未能保存跟進事項，請重試。"};const {data:old}=await supabase.from("wa_drafts").select("id,owner_id,payload,decided_at").eq("id",note.id).maybeSingle();if(!old)return{ok:false,error:"事項代號重複，請重新載入。"};try{const original=openCoaching(old);if(original.authorId!==profile.id||original.clientId!==note.clientId||original.request!==note.request||original.dueDay!==note.dueDay)return{ok:false,error:"上次指示已保存，請重新載入後新增另一項。"};}catch{return{ok:false,error:"事項代號重複，請重新載入。"};}}
 else await audit(profile.id,note.ownerId,note.clientId,note.id,"open");
 refresh(note.clientId);return{ok:true,error:""};
}
export async function respondCoachingAction(input:{id:string;revision:string|null;reply:string;close:boolean}){
 const {supabase,profile}=await requireUser();if(!uuid.safeParse(input.id).success||input.reply.length>1500)return{ok:false,error:"事項或回覆格式無效。"};
 const {data:row,error}=await supabase.from("wa_drafts").select("id,owner_id,payload,decided_at").eq("id",input.id).eq("status","cancelled").maybeSingle();if(error||!row)return{ok:false,error:"搵唔到有權處理嘅跟進事項。"};
 let note:CoachingNote;try{note=openCoaching(row);}catch{return{ok:false,error:"事項格式無效。"};}
 const {data:client}=await supabase.from("clients").select("owner_id").eq("id",note.clientId).maybeSingle();if(!client||client.owner_id!==note.ownerId)return{ok:false,error:"客戶負責人已變更，請重新核對。"};
 if(note.revision!==input.revision)return{ok:false,error:"事項已更新，請重新載入。"};
 if(input.close){if(profile.role!=="admin")return{ok:false,error:"只限主管確認完成。"};note.status="closed";}
 else{if(note.ownerId!==profile.id)return{ok:false,error:"只限負責同事回覆。"};if(note.status==="closed"||!input.reply.trim())return{ok:false,error:"請填寫處理結果；已完成事項不能重寫。"};note.reply=input.reply.trim();note.repliedAt=new Date().toISOString();note.status="replied";}
 const next=new Date(Math.max(Date.now(),row.decided_at?new Date(row.decided_at).getTime()+1:0)).toISOString();let update=createAdminClient().from("wa_drafts").update({payload:sealCoaching(note),decided_at:next}).eq("id",note.id).eq("owner_id",note.ownerId).eq("status","cancelled");update=row.decided_at?update.eq("decided_at",row.decided_at):update.is("decided_at",null);const {data,error:writeError}=await update.select("id");if(writeError||data?.length!==1)return{ok:false,error:"事項已更新，請重新載入再試。"};
 await audit(profile.id,note.ownerId,note.clientId,note.id,note.status);refresh(note.clientId);return{ok:true,error:""};
}
