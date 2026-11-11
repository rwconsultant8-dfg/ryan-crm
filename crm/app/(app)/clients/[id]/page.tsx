import Link from "next/link";
import { notFound } from "next/navigation";
import { loadFollowups } from "@/lib/planner-data";
import { loadCalendarEntries } from "@/lib/activity-data";
import { decryptColumn } from "@/lib/secure";
import { readContactHistory } from "@/lib/followups";
import { hkToday } from "@/lib/weeks";
import ClientFollowups from "@/components/ClientFollowups";
import {clientBrief} from "@/lib/coaching/summary";
import {loadCoaching} from "@/lib/coaching/store";
import MeetingBrief from "@/components/MeetingBrief";
import MeetingNote from "@/components/MeetingNote";
import CoachingPanel from "@/components/CoachingPanel";
import ClientEditor from "@/components/ClientEditor";
import AuditList, { type AuditRow } from "@/components/AuditList";
import { requireUser, displayName, type Profile } from "@/lib/auth";
import { getClientFull } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, profile } = await requireUser();

  // RLS：唔係自己嘅客（又唔係主管）會攞唔到 → 404
  const client = await getClientFull(supabase, id);
  if (!client) notFound();

  const readOnly = client.owner_id !== profile.id;
  const today=hkToday();
  let coaching:Awaited<ReturnType<typeof loadCoaching>>=[],coachingError=false;
  try{coaching=(await loadCoaching(supabase,client.owner_id)).filter(note=>note.clientId===id);}catch{coachingError=true;}
  const [allTasks, allAppointments, {data: contactRow}] = await Promise.all([
    loadFollowups(supabase,client.owner_id), loadCalendarEntries(supabase,client.owner_id),
    supabase.from("clients").select("info").eq("id",id).maybeSingle(),
  ]);
  const contactInfo = contactRow ? decryptColumn(id,"info",contactRow.info) : {};


  const [{ data: people }, { data: audit }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name"),
    supabase
      .from("audit_log")
      .select("id, at, actor_id, action, changes, via")
      .eq("record_id", id)
      .order("at", { ascending: false })
      .limit(50),
  ]);
  const names = new Map((people as Pick<Profile, "id" | "email" | "full_name">[] | null ?? []).map((p) => [p.id, displayName(p)]));
  const owner = names.get(client.owner_id) ?? "—";
  const rows: AuditRow[] = (audit ?? []).map((a) => ({
    id: a.id,
    at: a.at,
    actor: names.get(a.actor_id) ?? "系統",
    action: a.action,
    changes: a.changes,
    via: a.via,
  }));

  return (
    <div className="narrow" style={{ maxWidth: 960 }}>
      {readOnly && (
        <p className="notice">
          👁 唯讀模式 — 負責員工：
          <Link href={`/admin/agents/${client.owner_id}`}>{owner}</Link>
        </p>
      )}
      <p className="small">
        <Link href={readOnly ? `/admin/agents/${client.owner_id}` : "/board"}>← 返回看板</Link>
      </p>
      <MeetingBrief clientName={client.info.name||"未命名客戶"} brief={clientBrief(client,allTasks,allAppointments,today)} ownerName={owner} readOnly={readOnly}/>
      {!readOnly&&<MeetingNote clientId={id} today={today}/>}
      {coachingError?<p className="error" role="alert">跟進事項暫時未能讀取，唔代表冇事項。</p>:<CoachingPanel clientId={id} notes={coaching} isAdmin={profile.role==="admin"} isOwner={!readOnly} today={today}/>}
      <ClientEditor
        client={{ id: client.id, stage: client.stage, season: client.season, info: client.info, checks: client.checks, forms: client.forms }}
        readOnly={readOnly}
      />
      <ClientFollowups clientId={id} tasks={allTasks.filter(t=>t.client_id===id)} appointments={allAppointments.filter(a=>a.client_id===id)} history={readContactHistory(contactInfo.contact_history)} today={hkToday()} readOnly={readOnly}/>
      <details className="history">
        <summary>修改記錄（{rows.length}）</summary>
        <AuditList rows={rows} />
      </details>
    </div>
  );
}
