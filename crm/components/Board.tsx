"use client";
import {ageLabel} from "@/lib/age";
import {customerTypeLabel} from "@/lib/customer-types";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { moveSeasonAction, moveStageAction, unsignAction } from "@/app/(app)/clients/actions";
import { hkToday } from "@/lib/weeks";
import { GENDERS, STAGES, boardStage, isClosedStage, isStage, type Checks, type Stage } from "@/lib/stages";
import { NO_SEASON, SIGNED_ZONE, normalizeSeason, stageForSeason, type SeasonColumn } from "@/lib/seasons";

export type BoardCard = {
  id: string;
  stage: Stage;
  season: SeasonColumn;
  ready: boolean;
  checks: Checks;
  name: string;
  age: string;
  gender: string;
  occupation: string;
  customerType?: string;
  ownerName?:string;
  lastContact?: string;
  next?: {day:string;time?:string;plan:string} | null;
};

const genderLabel = (g: string) => GENDERS.find((x) => x.value === g)?.label ?? "";

function CardBody({ c }: { c: BoardCard }) {
  const meta = [c.age && ageLabel(c.age), genderLabel(c.gender), c.occupation].filter(Boolean).join(" · ");
  return (
    <>
      <div className="row">
        <span className="name">{c.name || "（未命名）"}</span>{c.customerType && <span className="badge badge-grey">{customerTypeLabel(c.customerType)}</span>}{c.ownerName&&<small className="compact-next">負責：{c.ownerName}</small>}
        <span className="spacer" />
      </div>
      {meta && <div className="meta">{meta}</div>}
      {c.next !== undefined && c.stage !== "SIGNED" && c.stage !== "ISSUED" && <div className={`next-step ${c.next ? "" : "not-planned"}`}>
        <span className="small">{c.next ? `${c.next.day<hkToday() ? "已逾期 · " : ""}${c.next.day.slice(5)} ${c.next.time || ""}` : "未安排下一步"}</span>
        {c.next && <strong>{c.next.plan}</strong>}
      </div>}
      {c.lastContact && <div className="meta">上次聯絡 {c.lastContact}</div>}
    </>
  );
}

function NameOnly({ c }: { c: BoardCard }) {
  return <><span className="name">{c.name || "（未命名）"}</span>{c.customerType && <span className="badge badge-grey">{customerTypeLabel(c.customerType)}</span>}{c.next !== undefined && c.stage!=="SIGNED" && c.stage!=="ISSUED" && <small className="compact-next">{c.next ? `${c.next.day<hkToday()?"逾期 · ":""}${c.next.day.slice(5)} · ${c.next.plan}` : "未安排"}</small>}</>;
}

function DraggableCard({ c, readOnly, compact }: { c: BoardCard; readOnly: boolean; compact: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id, disabled: readOnly });
  return (
    <Link
      href={`/clients/${c.id}`}
      ref={setNodeRef}
      className={`client-card${compact ? " compact" : ""}${isDragging ? " dragging" : ""}`}
      data-testid="client-card"
      {...(readOnly ? {} : listeners)}
      {...(readOnly ? {} : attributes)}
    >
      {compact ? <NameOnly c={c} /> : <CardBody c={c} />}
    </Link>
  );
}

function Column({ col, cards, readOnly, compact, mobileSelected }: { col: BoardColumn; cards: BoardCard[]; readOnly: boolean; compact: boolean; mobileSelected:boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: readOnly });
  return (
    <section ref={setNodeRef} className={`column${mobileSelected ? " mobile-selected" : ""}${isOver ? " over" : ""}${col.done ? " column-done" : ""}`} data-stage={col.key}>
      <div className="column-head">
        <span>{col.label}</span>
        <span className="badge badge-grey">{cards.length}</span>
      </div>
      {!compact && col.hint && <p className="column-hint">{col.hint}</p>}
      {cards.map((c) => (
        <DraggableCard key={c.id} c={c} readOnly={readOnly} compact={compact} />
      ))}
      {cards.length === 0 && <p className="muted small" style={{ padding: "0 6px" }}>（冇）</p>}
    </section>
  );
}

export type BoardColumn = { key: string; label: string; hint?: string; done?: boolean };

function SignedClients({ cards, readOnly }: { cards: BoardCard[]; readOnly: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: SIGNED_ZONE, disabled: readOnly });
  return (
    <section ref={setNodeRef} className={`network-signed${isOver ? " over" : ""}`} data-stage={SIGNED_ZONE}>
      <div className="row"><b>已簽客戶</b><span className="badge badge-grey">{cards.length}</span></div>
      {!readOnly && <p className="small muted">簽單完成後拖到呢度；要撤回已簽，可以拖返上方分類。</p>}
      {cards.map((c) => (
        <div key={c.id} className="network-signed-client">
          <DraggableCard c={c} readOnly={readOnly} compact />
          {!readOnly && <Link className="small" href={`/business?add=${c.id}`}>加入本月生意表 →</Link>}
        </div>
      ))}
    </section>
  );
}

const STAGE_COLUMNS: BoardColumn[] = STAGES.map((stage) => ({
  key: stage.key, label: stage.label, done: isClosedStage(stage.key),
}));

/** 看板：groupBy="stage" 按階段，groupBy="season" 顯示人脈網三欄。 */
export default function Board({
  cards: initial,
  readOnly = false,
  groupBy = "stage",
  columns = STAGE_COLUMNS,
  compact = false,
  simple = false,
}: {
  cards: BoardCard[];
  readOnly?: boolean;
  groupBy?: "stage" | "season";
  columns?: BoardColumn[];
  /** true = 人名卡片，以三欄並排顯示 */
  compact?: boolean;
  simple?: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [mobileColumn,setMobileColumn]=useState(columns.find(col=>initial.some(c=>(groupBy==="stage"?boardStage(c.stage):normalizeSeason(c.season))===col.key))?.key || columns[0]?.key || "");
  useEffect(() => setCards(initial), [initial]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; href?: string; link?: string } | null>(null);
  const [, startTransition] = useTransition();

  const isSigned = (c: BoardCard) => isClosedStage(c.stage);
  const colOf = (c: BoardCard): string => (groupBy === "stage" ? boardStage(c.stage) : isSigned(c) ? SIGNED_ZONE : normalizeSeason(c.season));

  // 滑鼠拖 6px 先算拖；手機長按 250ms 先開始拖，避免同捲動打交
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const run = (prev: BoardCard[], fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setCards(prev);
        setError(res.error ?? "儲存失敗");
      } else {
        after?.();
        router.refresh();
      }
    });

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const to = e.over ? String(e.over.id) : undefined;
    const card = cards.find((c) => c.id === id);
    if (readOnly || !card || !to || colOf(card) === to) return;
    const prev = cards;
    setError(null);
    setNotice(null);

    if (groupBy === "stage") {
      if (!isStage(to)) return;
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: to } : c)));
      return run(prev, () => moveStageAction(id, to));
    }

    // 已簽客戶獨立放喺三欄下面。
    if (to === SIGNED_ZONE) {
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: "SIGNED" } : c)));
      return run(
        prev,
        () => moveStageAction(id, "SIGNED"),
        () => setNotice({ text: `🎉「${card.name}」已簽！`, href: `/business?add=${id}`, link: "加入本月生意表 →" }),
      );
    }

    // 由「已簽」拖返出去 = 撤回已簽（階段改返 PC）
    if (isSigned(card)) {
      if (!window.confirm(`撤回「${card.name}」嘅已簽狀態？階段會改到對應嘅跟進分類。`)) return;
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, stage: stageForSeason(to) as Stage, season: to as SeasonColumn } : c)));
      return run(prev, () => unsignAction(id, to === NO_SEASON ? null : to));
    }

    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, season: to as SeasonColumn, stage: stageForSeason(to) as Stage } : c)));
    run(prev, () => moveSeasonAction(id, to === NO_SEASON ? null : to));
  };

  const active = cards.find((c) => c.id === activeId);

  return (
    <>
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice" data-testid="board-notice">
          {notice.text}{" "}
          {notice.href && <Link href={notice.href}>{notice.link}</Link>}
        </p>
      )}
      <label className="board-mobile-filter field"><span>{groupBy==="stage"?"按客戶進度查看":"按人脈分類查看"}</span><select aria-label="選擇客戶分類" value={mobileColumn} onChange={e=>setMobileColumn(e.target.value)}>{columns.map(col=><option key={col.key} value={col.key}>{col.label} · {cards.filter(c=>colOf(c)===col.key).length} 位</option>)}</select></label>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className={compact ? "board board-compact" : "board"}>
          {columns.map((col) => (
            <Column key={col.key} col={col} cards={cards.filter((c) => colOf(c) === col.key).sort((a,b)=>(a.next?.day || "9999").localeCompare(b.next?.day || "9999"))} readOnly={readOnly} compact={compact || simple} mobileSelected={col.key===mobileColumn} />
          ))}
        </div>
        {groupBy === "season" && <SignedClients cards={cards.filter(isSigned)} readOnly={readOnly} />}
        <DragOverlay>
          {active ? (
            <div className={`client-card drag-overlay${compact || simple ? " compact" : ""}`}>
              {compact || simple ? <NameOnly c={active} /> : <CardBody c={active} />}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
