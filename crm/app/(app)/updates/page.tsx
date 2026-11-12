import Link from "next/link";
import { requireAdmin, displayName } from "@/lib/auth";
import { openDraft } from "@/lib/whatsapp/drafts";
import { describeDraft, type Draft } from "@/lib/whatsapp/apply";
import DraftButtons from "../whatsapp/DraftButtons";
import styles from "./updates.module.css";
import { coachUsername } from "@/lib/telegram/config";

const lanes = [
  { key: "pending", label: "待確認", hint: "同事核對內容後，先會寫入客戶檔案。" },
  { key: "applied", label: "已寫入", hint: "已完成儲存，可以打開相關記錄。" },
  { key: "cancelled", label: "已取消", hint: "保留原文同整理記錄，方便追返。" },
] as const;
type Status = typeof lanes[number]["key"];
type Update = { id: string; owner_id: string; status: Status; created_at: string; draft: Draft };

export default async function UpdatesPage() {
  const { supabase, profile } = await requireAdmin();
  const teamView = profile.role === "admin";
  let query = supabase.from("wa_drafts").select("id, owner_id, status, payload, created_at").order("created_at", { ascending: false }).limit(150);
  if (!teamView) query = query.eq("owner_id", profile.id);
  const { data, error } = await query;
  if (error) return <><h1>同事更新</h1><p className="error" role="alert">暫時未能讀取更新，請稍後再試。</p></>;

  const updates: Update[] = [];
  let unreadable = 0;
  for (const row of data ?? []) {
    if(row.payload.startsWith("codex-job-v1.")||row.payload.startsWith("coach-action-v1."))continue;
    try {
      const draft = openDraft(row.id, row.payload);
      if (draft.channel !== "telegram" || !lanes.some(l => l.key === row.status)) continue;
      if (!draft.extraction || !draft.target || !Array.isArray(draft.texts)) { unreadable++; continue; }
      updates.push({ id: row.id, owner_id: row.owner_id, status: row.status as Status, created_at: row.created_at, draft });
    } catch { unreadable++; }
  }
  const ownerIds = [...new Set(updates.map(u => u.owner_id))];
  const { data: people } = teamView && ownerIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds)
    : { data: [{ id: profile.id, full_name: profile.full_name, email: profile.email }] };
  const owners = new Map((people ?? []).map(p => [p.id, displayName(p)]));
  const bot = coachUsername();

  return <>
    <div className="section-heading"><div><span className="eyebrow">TEAM UPDATES</span><h1>同事更新</h1><p className="muted">{teamView ? "全隊同事嘅客戶更新，由原文到寫入進度，一眼睇清。" : "你提交嘅客戶更新同處理進度。"}</p></div></div>
    <section className="card"><h2>講低最新情況，助手幫你整理</h2><p>私訊 Telegram 助手，講埋客戶全名、傾過嘅重點同下一步。助手會列出準備更新嘅內容；核對後回覆「確認」，Dashboard 就會更新。</p>{bot ? <a className="btn btn-primary" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">搵助手交代更新 ↗</a> : <p className="notice" role="status">Telegram 入口連線設定中；完成後，呢度會提供助手連結。</p>}</section>
    {unreadable > 0 && <p className="notice" role="status">部分歷史記錄未能顯示，原有內容已保留。</p>}
    <p className="small muted">以下顯示最近 150 筆助手記錄中嘅 Telegram 更新。{teamView ? "主管可查看全隊；每位同事確認自己提交嘅內容。" : "只顯示你自己嘅記錄。"}</p>
    <div className={styles.board}>{lanes.map(lane => {
      const cards = updates.filter(u => u.status === lane.key);
      return <section className={styles.lane} key={lane.key} aria-label={lane.label}><div className="row"><h2>{lane.label}</h2><span className="badge badge-grey">{cards.length}</span></div><p className="small muted">{lane.hint}</p>
        {cards.length === 0 && <p className={styles.empty}>暫時未有更新</p>}
        {cards.map(update => {
          const { draft } = update, target = draft.target;
          const clarification = draft.extraction.clarification?.trim();
          const client = target.mode === "existing" || target.mode === "new" ? target : null;
          return <article className={`card ${styles.update}`} key={update.id}><strong>{owners.get(update.owner_id) || "同事"}</strong><p className="small muted"><time dateTime={update.created_at}>{new Date(update.created_at).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })}</time></p><h3>{client?.name || (draft.extraction.tasks?.length ? "工作安排更新" : "日曆／跟進更新")}</h3>
            <div className={styles.preview}>{clarification || describeDraft(draft).replace(/^(?:📝 )?幫你整理咗（未儲存）：\n+/, "").replace(/\n回覆「確認」.*$/s, "")}</div>
            <details><summary>查看同事原文</summary><p className={styles.preview}>{draft.texts.join("\n\n")}</p></details>
            {update.status === "pending" && (clarification ? <p className="small muted">等提交嘅同事補資料。</p> : update.owner_id === profile.id ? <DraftButtons id={update.id}/> : <p className="small muted">等提交嘅同事確認。</p>)}
            {update.status === "applied" && <div className="row">{client && <Link href={`/clients/${client.id}`}>打開客戶檔案 ↗</Link>}{draft.extraction.tasks?.length ? <Link href={`/today${teamView && update.owner_id !== profile.id ? `?agent=${update.owner_id}` : ""}`}>查看工作安排 ↗</Link> : null}</div>}
          </article>;
        })}
      </section>;
    })}</div>
  </>;
}
