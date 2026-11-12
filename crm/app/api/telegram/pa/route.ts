import { after, NextResponse, type NextRequest } from "next/server";
import { paAllowed, paReady, paSecret } from "@/lib/telegram/config";
import { parsePrivateMessage, verifyWebhookSecret } from "@/lib/telegram/transport";
import { handlePAIncoming } from "@/lib/telegram/pa";
import { runtimeBotsSeparate } from "@/lib/telegram/credentials";
import { withAIIdentity } from "@/lib/ai-client";

export const maxDuration=60;
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({bot:"ryan-pa",configured:paReady() && await runtimeBotsSeparate()});}
export async function POST(request:NextRequest){
  if(!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"),paSecret()))return new NextResponse("Unauthorized",{status:401});
  if(!paReady() || !await runtimeBotsSeparate())return new NextResponse("Not configured",{status:503});
  let raw:unknown;try{raw=await request.json();}catch{return new NextResponse("Invalid JSON",{status:400});}
  const message=parsePrivateMessage(raw);
  const identity=request.headers.get("x-vercel-oidc-token");
  if(message && paAllowed(message.from))after(async()=>withAIIdentity(identity,async()=>{try{await handlePAIncoming(message);}catch{console.error("PA message processing failed");}}));
  return NextResponse.json({ok:true});
}
