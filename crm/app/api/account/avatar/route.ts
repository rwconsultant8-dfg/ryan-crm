import {requireUser} from "@/lib/auth";
import {getProfileAvatar} from "@/lib/profile-avatar";
import {RYAN_PHOTO_BASE64} from "@/lib/profile/ryan-photo";
import {CHELSEA_PHOTO_BASE64} from "@/lib/profile/chelsea-photo";
import {KIKY_PHOTO_BASE64} from "@/lib/profile/kiky-photo";
import {MOMO_PHOTO_BASE64} from "@/lib/profile/momo-photo";
export const dynamic="force-dynamic";
const photos={ryan:RYAN_PHOTO_BASE64,chelsea:CHELSEA_PHOTO_BASE64,kiky:KIKY_PHOTO_BASE64,momo:MOMO_PHOTO_BASE64};
export async function GET(){
 const {profile}=await requireUser();
 try{
  const avatar=await getProfileAvatar(profile);
  if(!avatar)return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
  return new Response(new Uint8Array(Buffer.from(photos[avatar.key],"base64")),{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
 }catch{return new Response(null,{status:503,headers:{"Cache-Control":"private, no-store"}});}
}
