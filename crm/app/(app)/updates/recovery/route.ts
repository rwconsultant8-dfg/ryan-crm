import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { noteRecoveryState } from "@/lib/codex/note-recovery";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  return NextResponse.json(await noteRecoveryState(createAdminClient()), {
    headers: { "Cache-Control": "no-store" },
  });
}
