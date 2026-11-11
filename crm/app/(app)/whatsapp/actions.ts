"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyDraft } from "@/lib/whatsapp/apply";
import { openDraft, reopen, setStatus } from "@/lib/whatsapp/drafts";

export type DraftResult = { ok: boolean; message: string };

/** 喺 app 入面確認／取消 Telegram 草稿（先用員工自己身份確認係佢嘅草稿） */
export async function decideDraftAction(id: string, decision: "apply" | "cancel"): Promise<DraftResult> {
  const { supabase, profile } = await requireUser();
  const { data: row } = await supabase.from("wa_drafts").select("id, owner_id, status, payload").eq("id", id).maybeSingle();
  if (!row || row.owner_id !== profile.id) return { ok: false, message: "冇權限" };
  if (row.status !== "pending") return { ok: false, message: "呢份已經處理咗" };

  const draft = openDraft(id, row.payload);
  if (draft.channel !== "telegram") return { ok: false, message: "舊渠道草稿已停用，請喺 Telegram 重新提交。" };
  const admin = createAdminClient();
  if (decision === "cancel") {
    await setStatus(admin, id, "cancelled");
    revalidatePath("/telegram");
    revalidatePath("/updates");
    return { ok: true, message: "已取消" };
  }
  if (draft.target.mode === "ambiguous") return { ok: false, message: "未確定係邊個客，請喺 Telegram 講全名" };
  if (!(await setStatus(admin, id, "applied"))) return { ok: false, message: "呢份已經處理咗" };
  try {
    await applyDraft(admin, profile.id, draft, id);
  } catch (e) {
    await reopen(admin, id);
    return { ok: false, message: "儲存失敗：" + (e as Error).message };
  }
  revalidatePath("/telegram");
  revalidatePath("/updates");
  revalidatePath("/board");
  revalidatePath("/today");
  revalidatePath("/review");
  return { ok: true, message: "已儲存" };
}

