import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeExpiredNoteRecovery, noteRecoveryState } from "@/lib/codex/note-recovery";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  return NextResponse.json(await noteRecoveryState(createAdminClient()), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const status = await completeExpiredNoteRecovery(createAdminClient(), request.headers.get("authorization"));
  return NextResponse.json({status}, {
    status: status === "unauthorized" ? 401 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
