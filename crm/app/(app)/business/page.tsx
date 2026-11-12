import Link from "next/link";
import BusinessMonth from "@/components/BusinessMonth";
import BusinessTeam, { type BusinessMember } from "@/components/BusinessTeam";
import { requireUser, displayName, type Profile } from "@/lib/auth";
import { addMonths, isMonth, monthLabel, BUSINESS_SORTS, businessSort, emptyTarget, sortBusinessRows, type BusinessSort } from "@/lib/business";
import { loadMonth, loadTeamMonth } from "@/lib/business-data";
import { listClientCards } from "@/lib/data";
import { resolveViewedOwner } from "@/lib/viewing";
import { hkToday } from "@/lib/weeks";

function MonthNavigation({ ym, thisMonth, agent, sort }: { ym: string; thisMonth: string; agent?: string; sort?: BusinessSort }) {
  const href = (month: string) => {
    const query = new URLSearchParams({ month });
    if (agent) query.set("agent", agent);
    if (sort) query.set("sort", sort);
    return `/business?${query}`;
  };
  return <div className="row" style={{ marginBottom: 12 }}>
    <Link className="btn btn-sm" href={href(addMonths(ym, -1))}>← 上月</Link>
    <b>{monthLabel(ym)}</b>
    <Link className="btn btn-sm" href={href(addMonths(ym, 1))}>下月 →</Link>
    {ym !== thisMonth && <Link className="btn btn-sm" href={href(thisMonth)}>返本月</Link>}
  </div>;
}

function ManagerFilters({ members, ym, agent, sort }: { members: BusinessMember[]; ym: string; agent: string; sort: BusinessSort }) {
  return <form key={`${ym}:${agent}:${sort}`} className="card business-filters" action="/business" method="get">
    <label className="field"><span>月份</span><input type="month" name="month" defaultValue={ym} required /></label>
    <label className="field"><span>查看同事</span><select name="agent" defaultValue={agent}>
      <option value="all">全團隊總覽</option>
      {members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.active ? "" : "（已停用）"}</option>)}
    </select></label>
    <label className="field"><span>排序</span><select name="sort" defaultValue={sort}>
      {BUSINESS_SORTS.filter((option) => agent === "all" || option.value !== "cases_desc").map((option) => <option key={option.value} value={option.value}>{option.value === "name_asc" ? agent === "all" ? "同事姓名" : "客戶姓名" : option.label}</option>)}
    </select></label>
    <button className="btn btn-primary" type="submit">查看</button>
  </form>;
}

export default async function BusinessPage({ searchParams }: {
  searchParams: Promise<{ month?: string; agent?: string; add?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const isAdmin = profile.role === "admin";
  const thisMonth = hkToday().slice(0, 7);
  const ym = isMonth(sp.month) ? sp.month : thisMonth;
  let sort = businessSort(sp.sort);
  let managerFilters: React.ReactNode = null;

  if (isAdmin) {
    const [peopleResult, teamResult] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, role, active").order("full_name"),
      loadTeamMonth(supabase, ym).then((data) => ({ data, error: null }), (error: unknown) => ({ data: null, error })),
    ]);
    if (peopleResult.error || teamResult.error || !teamResult.data) return <>
      <h1>團隊生意總覽</h1>
      <MonthNavigation ym={ym} thisMonth={thisMonth} />
      <p className="error" role="alert">暫時未能讀取團隊生意，請重新載入再試。</p>
    </>;
    const team = teamResult.data;
    const members: BusinessMember[] = ((peopleResult.data ?? []) as Profile[])
      .filter((person) => person.active || team.has(person.id))
      .map((person) => ({ id: person.id, name: displayName(person), active: person.active, ...(team.get(person.id) ?? { done: emptyTarget(), target: emptyTarget() }) }));
    const agent = sp.agent && sp.agent !== "all" ? sp.agent : sp.add && !sp.agent ? profile.id : "all";
    if (agent !== "all" && sort === "cases_desc") sort = "afyp_desc";
    managerFilters = <ManagerFilters members={members} ym={ym} agent={agent} sort={sort} />;
    if (agent === "all") return <>
      <h1>團隊生意總覽</h1>
      {managerFilters}
      <MonthNavigation ym={ym} thisMonth={thisMonth} sort={sort} />
      <BusinessTeam members={members} ym={ym} sort={sort} />
    </>;
    if (!members.some((member) => member.id === agent)) return <>
      <h1>團隊生意表</h1>
      <p className="error" role="alert">搵唔到呢位同事，請重新選擇。</p>
      <ManagerFilters members={members} ym={ym} agent="all" sort={sort} />
    </>;
  }

  const { owner, readOnly } = await resolveViewedOwner(supabase, profile, sp.agent);
  const [{ cases, target }, cards, { data: linked, error: linkedError }] = await Promise.all([
    loadMonth(supabase, owner.id, ym),
    listClientCards(supabase, owner.id),
    supabase.from("business_cases").select("client_id").eq("owner_id", owner.id).not("client_id", "is", null),
  ]);
  if (linkedError) throw new Error(linkedError.message);
  const clients = cards.map((card) => ({ id: card.id, name: card.info.name })).filter((card) => card.name);
  const recorded = new Set((linked ?? []).map((row) => row.client_id as string));
  const signedToAdd = cards.filter((card) => (card.stage === "SIGNED" || card.stage === "ISSUED") && !recorded.has(card.id))
    .map((card) => ({ id: card.id, name: card.info.name }));
  const shownCases = isAdmin ? sortBusinessRows(cases.map((row) => ({ ...row, name: row.client_name })), sort) : cases;

  return <>
    {isAdmin && <p className="small"><Link href={`/business?month=${ym}&sort=${sort}`}>← 全團隊總覽</Link></p>}
    <h1>{readOnly ? `${displayName(owner)} 嘅每月生意` : "每月生意表"}</h1>
    {managerFilters}
    {readOnly && <p className="notice">👁 唯讀 — 由同事填寫及更新生意記錄</p>}
    <MonthNavigation ym={ym} thisMonth={thisMonth} agent={isAdmin ? owner.id : undefined} sort={isAdmin ? sort : undefined} />
    <BusinessMonth
      key={`${owner.id}:${ym}:${isAdmin ? sort : "original"}`}
      ym={ym} cases={shownCases} target={target} clients={clients}
      signedToAdd={readOnly ? [] : signedToAdd}
      addClientId={readOnly ? undefined : sp.add}
      readOnly={readOnly}
    />
  </>;
}
