import Link from "next/link";
import { hkd, MONEY_KEYS, MONEY_LABELS, pct, sortBusinessRows, sumTargets, type BusinessSort, type Target } from "@/lib/business";

export type BusinessMember = { id: string; name: string; active: boolean; done: Target; target: Target };

export default function BusinessTeam({ members, ym, sort }: { members: BusinessMember[]; ym: string; sort: BusinessSort }) {
  const done = sumTargets(members.map((member) => member.done));
  const target = sumTargets(members.map((member) => member.target));
  const rows = sortBusinessRows(members.map((member) => ({ ...member, ...member.done })), sort);
  return (
    <section aria-label="團隊生意總覽">
      <div className="biz-summary">
        {(["cases", ...MONEY_KEYS] as const).map((key) => (
          <div className="wk-tile biz-tile" key={key}>
            <div className="muted small">團隊{key === "cases" ? " Case" : ` ${MONEY_LABELS[key]}`}</div>
            <div className="biz-num" data-testid={`team-${key}`}>{key === "cases" ? `${done[key]} 單` : hkd(done[key])}</div>
            <div className="muted small">已設目標合計：{target[key] > 0 ? key === "cases" ? `${target[key]} 單` : hkd(target[key]) : "未設"}</div>
          </div>
        ))}
      </div>
      <h2>同事生意一覽</h2>
      <p className="muted small">按同事姓名查看該月逐單記錄；金額以 HK$ 計。未設目標顯示「—」。</p>
      <div className="table-wrap">
        <table className="business-team-table">
          <caption className="sr-only">團隊每月生意及 AFYP 目標完成度</caption>
          <thead><tr><th scope="col">同事</th><th scope="col" className="num">Case 數</th>{MONEY_KEYS.map((key) => <th scope="col" className="num" key={key}>{MONEY_LABELS[key]}</th>)}<th scope="col" className="num">AFYP 目標</th><th scope="col" className="num">AFYP 完成度</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">暫時未有同事資料。</td></tr>}
            {rows.map((member) => {
              const rate = pct(member.done.afyp, member.target.afyp);
              return <tr key={member.id} data-owner={member.id}>
                <th scope="row"><Link href={`/business?month=${ym}&agent=${encodeURIComponent(member.id)}&sort=${sort === "cases_desc" ? "afyp_desc" : sort}`}>{member.name}</Link>{!member.active && <span className="muted small">（已停用）</span>}</th>
                <td className="num">{member.done.cases}</td>
                {MONEY_KEYS.map((key) => <td key={key} className="num">{hkd(member.done[key])}</td>)}
                <td className="num">{member.target.afyp > 0 ? hkd(member.target.afyp) : "—"}</td>
                <td className="num">{rate === null ? "—" : `${rate}%`}</td>
              </tr>;
            })}
          </tbody>
          <tfoot><tr><th scope="row">團隊合計</th><td className="num">{done.cases}</td>{MONEY_KEYS.map((key) => <td key={key} className="num">{hkd(done[key])}</td>)}<td className="num">{target.afyp > 0 ? hkd(target.afyp) : "—"}</td><td className="num">—</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}
