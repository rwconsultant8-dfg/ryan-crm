import { after, NextResponse, type NextRequest } from "next/server";
import { handleTelegramIncoming } from "@/lib/telegram/handle";
import { parsePrivateMessage, verifyWebhookSecret } from "@/lib/telegram/transport";
import { coachSecret } from "@/lib/telegram/config";
import { isCoachReady } from "@/lib/telegram/credentials";
import {codexWorkerConfigured} from "@/lib/codex/jobs";
import {createAdminClient} from "@/lib/supabase/admin";
import {conversationProbeStatus} from "@/lib/codex/conversation-probe";

import {assistantProbeStatus} from "@/lib/assistant/health";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ channel: "telegram", uiVersion:"zest-identity-v4", syncMode:"automatic", assistantMode:"chat-and-updates", bot:"ryan-coach",displayName:"ZEST 團隊助手", configured: await isCoachReady(), processor:"codex", workerConfigured:codexWorkerConfigured(),assistantTools:{version:"v1",webSearch:true,downloadFiles:true,powerPoint:"text-edit",ocr:["chi_tra","eng"],forms:["pdf-acroform","xlsx"]},assistantToolCheck:await assistantProbeStatus(createAdminClient()),conversationCheck:await conversationProbeStatus(createAdminClient()) }); }
export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), coachSecret())) return new NextResponse("Unauthorized", { status: 401 });
  if (!await isCoachReady()) return new NextResponse("Not configured", { status: 503 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return new NextResponse("Invalid JSON", { status: 400 }); }
  const message = parsePrivateMessage(payload);
  if (message) after(async () => {
    try { await handleTelegramIncoming(message); }
    catch { console.error("Telegram message processing failed"); }
  });
  return NextResponse.json({ ok: true });
}
