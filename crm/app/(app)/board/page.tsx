import { isClosedStage } from "@/lib/stages";
import Link from "next/link";
import Board from "@/components/Board";
import { requireUser } from "@/lib/auth";
import { listClientCards, toBoardCards } from "@/lib/data";

export default async function BoardPage() {
  const { supabase, profile } = await requireUser();
  const cards = await listClientCards(supabase, profile.id);
  const ready = cards.filter((c) => c.ready_to_sign && !isClosedStage(c.stage)).length;
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>我的看板</h1>
        <span className="badge badge-grey">{cards.length} 個客</span>
        {ready > 0 && <span className="badge badge-green">{ready} 個具備簽單條件</span>}
        <span className="spacer" />
        <Link className="btn btn-primary" href="/clients/new">
          ＋ 新增客戶
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        拖拉卡片轉階段（手機：長按卡片再拖）。撳卡片入去填表。
      </p>
      <Board cards={toBoardCards(cards)} />
    </>
  );
}
