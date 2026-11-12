import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileScope, readBotFile } from "@/lib/telegram/files";

export async function GET(_request:Request,{params}:{params:Promise<{name:string}>}){
  const {profile}=await requireUser();
  try{
    const {name}=await params;
    const file=await readBotFile(createAdminClient(),fileScope("coach",profile.id),name);
    return new Response(new Uint8Array(file.body),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch{return new Response("搵唔到你嘅檔案",{status:404,headers:{"Cache-Control":"private, no-store"}});}
}
