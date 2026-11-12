import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCoachToken } from "@/lib/telegram/credentials";
import { briefAuthorized, briefDay, loadMorningBrief, verifyBriefRecipient } from "@/lib/telegram/morning-brief";

export const dynamic = "force-dynamic";
const response = (status: string, code = 200) => NextResponse.json({ status }, { status: code, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!briefAuthorized(request.headers.get("authorization"))) return response("unauthorized", 401);
  const mode = request.nextUrl.searchParams.get("mode") ?? "daily";
  if (!["daily", "test", "check"].includes(mode)) return response("invalid_mode", 400);
  const now = Date.now(), day = briefDay(now, mode !== "daily");
  if (!day) return response("outside_schedule", 409);
  let phase = "recipient";
  try {
    const db = createAdminClient();
    const [recipient, token] = await Promise.all([verifyBriefRecipient(db), resolveCoachToken()]);
    if (!token) return response("bot_not_configured", 503);
    phase = "read";
    const text = await loadMorningBrief(db, day, now, mode === "test");
    if (mode === "check") return response("ready");

    phase = "claim";
    const key = `zest-ryan-brief-v1:${mode}:${day}`;
    const claim = await db.from("wa_seen_messages").insert({ message_id: key });
    if (claim.error?.code === "23505") {
      const sent = await db.from("wa_seen_messages").select("message_id").eq("message_id", `${key}:sent`).maybeSingle();
      return sent.data ? response("already_sent") : response("delivery_uncertain", 409);
    }
    if (claim.error) throw Error("Delivery claim unavailable");

    phase = "send";
    const result = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify({ chat_id: recipient, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15000),
    });
    const telegram = await result.json();
    if (!result.ok || telegram.ok !== true || !Number.isSafeInteger(telegram.result?.message_id)) {
      // Explicit rejection means it was not delivered. Keep the claim when the result is ambiguous.
      if (telegram.ok === false && result.status >= 400 && result.status < 500) {
        await db.from("wa_seen_messages").delete().eq("message_id", key);
        return response("telegram_rejected", 502);
      }
      throw Error("Delivery uncertain");
    }
    phase = "receipt";
    const receipt = await db.from("wa_seen_messages").insert({ message_id: `${key}:sent` });
    if (receipt.error) throw Error("Delivery receipt unavailable");
    return response("sent");
  } catch {
    console.error("Ryan morning brief unavailable:", phase);
    return response(phase === "send" || phase === "receipt" ? "delivery_uncertain" : `unavailable_${phase}`, 503);
  }
}
