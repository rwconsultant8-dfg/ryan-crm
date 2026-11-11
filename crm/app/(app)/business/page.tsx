import { isClosedStage } from "@/lib/stages";
import Link from "next/link";
import BusinessMonth from "@/components/BusinessMonth";
import { requireUser, displayName } from "@/lib/auth";
import { addMonths, isMonth, monthLabel } from "@/lib/business";
import { loadMonth } from "@/lib/business-data";
import { listClientCards } from "@/lib/data";
import { resolveViewedOwner } from "@/lib/viewing";
import { hkToday } from "@/lib/weeks";

export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; agent?: string; add?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const { owner, readOnly } = await resolveViewedOwner(supabase, profile, sp.agent);
  const thisMonth = hkToday().slice(0, 7);
  const ym = isMonth(sp.month) ? sp.month : thisMonth;

  const [{ cases, target }, cards, { data: linked }] = await Promise.all([
    loadMonth(supabase, owner.id, ym),
    listClientCards(supabase, owner.id),
    supabase.from("business_cases").select("client_id").eq("owner_id", owner.id).not("client_id", "is", null),
  ]);
  const clients = cards.map((c) => ({ id: c.id, name: c.info.name })).filter((c) => c.name);
  const recorded = new Set((linked ?? []).map((r) => r.client_id as string));
  // Closing 或 Referral 客戶仲未入過生意表
  const signedToAdd = cards
    .filter((c) => isClosedStage(c.stage) && !recorded.has(c.id))
    .map((c) => ({ id: c.id, name: c.info.name }));

  const q = (m: string) => `/business?month=${m}${readOnly ? `&agent=${owner.id}` : ""}`;

  return (
    <>
      {readOnly && (
        <p className="small">
          <Link href={`/admin/agents/${owner.id}`}>← {displayName(owner)} 嘅看板</Link>
        </p>
      )}
      <h1>{readOnly ? `${displayName(owner)} 嘅每月生意` : "每月生意表"}</h1>
      {readOnly && <p className="notice">👁 唯讀</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <Link className="btn btn-sm" href={q(addMonths(ym, -1))}>
          ← 上月
        </Link>
        <b>{monthLabel(ym)}</b>
        <Link className="btn btn-sm" href={q(addMonths(ym, 1))}>
          下月 →
        </Link>
        {ym !== thisMonth && (
          <Link className="btn btn-sm" href={q(thisMonth)}>
            返本月
          </Link>
        )}
      </div>
      <BusinessMonth
        key={`${owner.id}:${ym}`}
        ym={ym}
        cases={cases}
        target={target}
        clients={clients}
        signedToAdd={readOnly ? [] : signedToAdd}
        addClientId={readOnly ? undefined : sp.add}
        readOnly={readOnly}
      />
    </>
  );
}
