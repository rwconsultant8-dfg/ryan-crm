import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Profile} from "./auth";
import {createAdminClient} from "./supabase/admin";
import {isMomoAvatarAccount} from "./member-identity";
export type ProfileAvatarInfo={key:"ryan"|"chelsea"|"kiky"|"momo";label:string;accountId?:string};
const portraits:ProfileAvatarInfo[]=[{key:"ryan",label:"Ryan"},{key:"chelsea",label:"Chelsea"},{key:"kiky",label:"Kiky"},{key:"momo",label:"Momo"}];
export function avatarCandidate(profile:Pick<Profile,"full_name"|"role"|"active"> & Partial<Pick<Profile,"email">>):ProfileAvatarInfo|null{
 if(!profile.active)return null;
 if(isMomoAvatarAccount(profile.email))return portraits[3];
 const name=(profile.full_name||"").trim();
 if(profile.role==="admin"&&/\bryan\b/i.test(name))return portraits[0];
 if(/\b(?:chelsea|chelsae)\b/i.test(name))return portraits[1];
 if(/\b(?:kiky|kiki)\b/i.test(name))return portraits[2];
 return null;
}
/** Called only after requireUser. Check global uniqueness because staff RLS only shows themselves. */
export async function getProfileAvatar(profile:Profile):Promise<ProfileAvatarInfo|null>{
 const candidate=avatarCandidate(profile);if(!candidate)return null;
 const {data,error}=await createAdminClient().from("profiles").select("id,email,full_name,role,active").eq("active",true);
 if(error)throw Error("未能核對頭像帳戶");
 const matches=(data||[]).filter(p=>avatarCandidate(p)?.key===candidate.key);
 return matches.length===1&&matches[0].id===profile.id?{...candidate,accountId:profile.id}:null;
}
/** Deployment checks only; no profile, login, customer or permission changes. */
export async function verifyProfileAvatarAccounts(db:SupabaseClient){
 if(process.env.VERCEL_ENV!=="production")return;
 const {data,error}=await db.from("profiles").select("id,email,full_name,role,active").eq("active",true);if(error)throw Error("Avatar check unavailable");
 for(const portrait of portraits){
  const marker=`profile-avatar:${portrait.key}:account-portraits-v3`;
  const {data:done,error:readError}=await db.from("wa_seen_messages").select("message_id").eq("message_id",marker).maybeSingle();if(readError)throw Error("Avatar check unavailable");if(done)continue;
  const matches=(data||[]).filter(p=>avatarCandidate(p)?.key===portrait.key);
  if(matches.length!==1){console.error(`${portrait.label} profile photo: account could not be uniquely matched`);continue;}
  const {error:writeError}=await db.from("wa_seen_messages").insert({message_id:marker});if(writeError&&writeError.code!=="23505")throw Error("Avatar check unavailable");
  console.info(`${portrait.label} profile photo: unique active account verified`);
 }
}
