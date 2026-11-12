import { requireAdmin, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTelegramLinks } from "@/lib/telegram/registry";
import { CreateStaffForm, StaffTable } from "./StaffClient";

export default async function StaffPage() {
  const { supabase, profile } = await requireAdmin();
  const [{ data }, links] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, active").order("created_at"),
    listTelegramLinks(createAdminClient()),
  ]);
  return (
    <>
      <h1>員工帳戶</h1>
      <StaffTable staff={((data as Profile[] | null) ?? []).map(p => ({ ...p, telegram_id: links.get(p.id) ?? null }))} meId={profile.id} />
      <div style={{ marginTop: 20 }}>
        <CreateStaffForm />
      </div>
    </>
  );
}
