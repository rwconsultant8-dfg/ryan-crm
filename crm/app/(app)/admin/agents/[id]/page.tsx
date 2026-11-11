import { isClosedStage } from "@/lib/stages";
import Link from "next/link";
import { notFound } from "next/navigation";
import Board from "@/components/Board";
import { requireAdmin, displayName, type Profile } from "@/lib/auth";
import { listClientCards, toBoardCards } from "@/lib/data";

export default async function AgentBoard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile: me } = await requireAdmin();
  const { data: agent } = await supabase.from("profiles").select("id, email, full_name, role, active").eq("id", id).maybeSingle<Profile>();
  if (!agent) notFound();
  const cards = await listClientCards(supabase, id);
  const ready = cards.filter((c) => c.ready_to_sign && !isClosedStage(c.stage)).length;
  return (
    <>
      <p className="small">
        <Link href="/admin">← 主管總覽</Link>
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{displayName(agent)} 嘅看板</h1>
        <span className="badge badge-grey">{cards.length} 個客</span>
        {ready > 0 && <span className="badge badge-green">{ready} 個具備簽單條件</span>}
        {!agent.active && <span className="badge badge-red">已停用</span>}
        <span className="spacer" />
        <Link className="btn btn-sm" href={`/seasons?agent=${agent.id}`}>
          四季人脈
        </Link>
        <Link className="btn btn-sm" href={`/activity?agent=${agent.id}`}>
          活動分
        </Link>
        <Link className="btn btn-sm" href={`/pdca?agent=${agent.id}`}>
          PDCA
        </Link>
        <Link className="btn btn-sm" href={`/business?agent=${agent.id}`}>
          生意表
        </Link>
      </div>
      {agent.id !== me.id && <p className="notice">👁 唯讀 — 撳卡片睇詳情</p>}
      <Board cards={toBoardCards(cards)} readOnly={agent.id !== me.id} />
    </>
  );
}
