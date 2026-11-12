import AuditList, { type AuditRow } from "@/components/AuditList";
import { requireAdmin, displayName, type Profile } from "@/lib/auth";
import { decryptColumn } from "@/lib/secure";

const TABLE_LABELS: Record<string, string> = { activity_days: "日曆", pdca_weeks: "PDCA", okrs: "OKR", business_cases: "生意表", monthly_targets: "月目標", wa_drafts: "WhatsApp" };

export default async function AuditPage() {
  const { supabase } = await requireAdmin();
  const [{ data: audit }, { data: people }, { data: clients }] = await Promise.all([
    supabase.from("audit_log").select("id, at, actor_id, action, table_name, record_id, client_owner_id, changes, via").order("at", { ascending: false }).limit(300),
    supabase.from("profiles").select("id, email, full_name"),
    supabase.from("clients").select("id, info"),
  ]);
  const names = new Map(((people as Profile[] | null) ?? []).map((p) => [p.id, displayName(p)]));
  const clientNames = new Map(
    (clients ?? []).map((c) => [c.id as string, decryptColumn(c.id, "info", c.info).name ?? "—"]),
  );
  const rows: AuditRow[] = (audit ?? []).map((a) => ({
    id: a.id,
    at: a.at,
    actor: names.get(a.actor_id) ?? "系統",
    action: a.action,
    subject:
      a.table_name === "profiles"
        ? `員工：${names.get(a.record_id) ?? "—"}`
        : a.table_name === "clients"
          ? `客戶：${clientNames.get(a.record_id) ?? "（已刪除）"}`
          : `${TABLE_LABELS[a.table_name] ?? a.table_name}：${names.get(a.client_owner_id) ?? "—"}`,
    changes: a.changes,
    via: a.via,
  }));
  return (
    <>
      <h1>審計記錄</h1>
      <p className="muted small">由資料庫自動記錄，任何人（包括主管）都改唔到、刪唔到。顯示最近 300 項；加密欄位只顯示「改咗邊格」，唔顯示內容。</p>
      <AuditList rows={rows} showSubject />
    </>
  );
}
