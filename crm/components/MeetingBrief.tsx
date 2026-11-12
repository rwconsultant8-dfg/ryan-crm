import Link from "next/link";
import type { clientBrief } from "@/lib/coaching/summary";
import MeetingFocusForm from "./MeetingFocusForm";

type Props = {
  clientId: string;
  clientName: string;
  brief: ReturnType<typeof clientBrief>;
  ownerName: string;
  readOnly: boolean;
  coachingUnavailable: boolean;
};

export default function MeetingBrief({ clientId, brief, clientName, ownerName, readOnly, coachingUnavailable }: Props) {
  return (
    <section className="card meeting-brief" id="brief">
      <div className="row">
        <h2>{clientName} · 見客前簡報</h2>
        <span className="badge badge-grey">負責：{ownerName}</span>
      </div>
      <p className="small muted">最後實際聯絡：{brief.lastContact || "未有記錄"}</p>
      <div className="brief-grid">
        <div>
          <h3>上次傾過乜</h3>
          {brief.latest ? <>
            <p>{brief.latest.text}</p>
            <p className="small muted">{brief.latest.day || brief.latest.at.slice(0, 10)} · 已保存見客紀錄</p>
            {brief.latest.meeting?.response && <p><b>客戶反應：</b>{brief.latest.meeting.response}</p>}
            {brief.latest.meeting?.blocker && <p><b>卡位：</b>{brief.latest.meeting.blocker}</p>}
            {brief.latest.meeting?.needs_help && <p className="notice">同事提出需要 Ryan 協助</p>}
          </> : <p className="muted">未有結構化見客紀錄。</p>}
        </div>
        <div>
          <h3>今次重點／下一步</h3>
          {!brief.focus && !brief.guidance.length && !coachingUnavailable && <p className="muted">未有部署</p>}
          {brief.focus && (
            <div>
              <b>{ownerName} 嘅部署</b>
              {brief.focusDay && <p className="small muted">{brief.focusDay}</p>}
              <p style={{ whiteSpace: "pre-wrap" }}>{brief.focus}</p>
            </div>
          )}
          {brief.guidance.map((note) => (
            <div key={note.id}>
              <b>{note.authorName} 嘅主管指示</b>
              {note.dueDay && <p className="small muted">期限 {note.dueDay}</p>}
              <p style={{ whiteSpace: "pre-wrap" }}>{note.request}</p>
            </div>
          ))}
          {coachingUnavailable && <p className="error">暫時未能讀取主管指示。</p>}
          {!readOnly && <MeetingFocusForm key={JSON.stringify([clientId, brief.savedFocus, brief.focus])} clientId={clientId} focus={brief.focus} savedFocus={brief.savedFocus} />}
        </div>
      </div>
      <details>
        <summary>查看已記錄資料（{brief.known.length}項）</summary>
        <dl className="brief-facts">
          {brief.known.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.text}</dd></div>)}
        </dl>
      </details>
      {!readOnly && (
        <div className="row">
          <a className="btn btn-primary" href="#meeting-note">記低今次見客結果</a>
          <Link className="btn" href="#coaching">睇主管跟進</Link>
        </div>
      )}
    </section>
  );
}
