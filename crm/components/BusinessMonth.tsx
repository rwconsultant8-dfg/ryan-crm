"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveBusinessAction, saveTargetAction } from "@/app/(app)/business/actions";
import { MONEY_KEYS, MONEY_LABELS, hkd, parseAmount, pct, totals, type CaseRow, type Target } from "@/lib/business";

type Client = { id: string; name: string };
type EditRow = Omit<CaseRow, "afyp" | "revenue" | "commission"> & { afyp: string; revenue: string; commission: string };

let seq = 0;
const toEdit = (r: CaseRow): EditRow => ({
  ...r,
  afyp: r.afyp ? String(r.afyp) : "",
  revenue: r.revenue ? String(r.revenue) : "",
  commission: r.commission ? String(r.commission) : "",
});
const blankRow = (c?: Client): EditRow => ({
  id: `new-${++seq}`,
  client_id: c?.id ?? null,
  client_name: c?.name ?? "",
  product: "",
  note: "",
  afyp: "",
  revenue: "",
  commission: "",
});

function Progress({ label, done, target, money }: { label: string; done: number; target: number; money: boolean }) {
  const p = pct(done, target);
  const cls = p === null ? "" : p >= 100 ? "full" : p >= 50 ? "mid" : "low";
  return (
    <div className="wk-tile biz-tile" data-testid={`biz-${label}`}>
      <div className="muted small">本月{label}</div>
      <div className="biz-num">{money ? hkd(done) : done}</div>
      <div className="small muted">
        目標 {target > 0 ? (money ? hkd(target) : target) : "未設"}
        {p !== null && <b className={`biz-pct ${cls}`}> · {p}%</b>}
      </div>
      <div className="progress">
        <div style={{ width: `${Math.min(100, p ?? 0)}%` }} className={cls} />
      </div>
    </div>
  );
}

export default function BusinessMonth({
  ym,
  cases,
  target: initialTarget,
  clients,
  signedToAdd,
  addClientId,
  readOnly,
}: {
  ym: string;
  cases: CaseRow[];
  target: Target;
  clients: Client[];
  signedToAdd: Client[];
  addClientId?: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EditRow[]>(() => {
    const base = cases.map(toEdit);
    const add = addClientId && !cases.some((c) => c.client_id === addClientId) ? clients.find((c) => c.id === addClientId) : undefined;
    return add ? [...base, blankRow(add)] : base;
  });
  const [deleted, setDeleted] = useState<string[]>([]);
  const [dirty, setDirty] = useState(Boolean(addClientId && rows.some((r) => r.id.startsWith("new-"))));
  const [target, setTarget] = useState({
    cases: initialTarget.cases ? String(initialTarget.cases) : "",
    afyp: initialTarget.afyp ? String(initialTarget.afyp) : "",
    revenue: initialTarget.revenue ? String(initialTarget.revenue) : "",
    commission: initialTarget.commission ? String(initialTarget.commission) : "",
  });
  const [targetDirty, setTargetDirty] = useState(false);
  // 未設目標時第一次打開目標框；之後由用戶自己開／收
  const [targetOpenInit] = useState(!readOnly && initialTarget.afyp === 0 && initialTarget.cases === 0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tMsg, setTMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addClientId) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [addClientId]);

  useEffect(() => {
    if (!dirty && !targetDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, targetDirty]);

  const parsed = rows.map((r) => ({ afyp: parseAmount(r.afyp), revenue: parseAmount(r.revenue), commission: parseAmount(r.commission) }));
  const invalid = parsed.some((p) => MONEY_KEYS.some((k) => p[k] === null));
  const counted = rows.filter((r, i) => r.client_name.trim() || r.product.trim() || MONEY_KEYS.some((k) => (parsed[i][k] ?? 0) > 0));
  const sum = useMemo(
    () => totals(counted.map((r) => ({ afyp: parseAmount(r.afyp) ?? 0, revenue: parseAmount(r.revenue) ?? 0, commission: parseAmount(r.commission) ?? 0 }))),
    [counted],
  );
  const tNum = {
    cases: parseInt(target.cases || "0", 10) || 0,
    afyp: parseAmount(target.afyp) ?? 0,
    revenue: parseAmount(target.revenue) ?? 0,
    commission: parseAmount(target.commission) ?? 0,
  };

  const edit = (id: string, k: keyof EditRow, v: string) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        if (k === "client_name") {
          const match = clients.find((c) => c.name === v.trim());
          return { ...r, client_name: v, client_id: match?.id ?? null };
        }
        return { ...r, [k]: v };
      }),
    );
    setDirty(true);
    setMsg(null);
  };

  const remove = (r: EditRow) => {
    if ((r.client_name || r.product) && !confirm(`刪除「${r.client_name || r.product}」呢單？`)) return;
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    if (!r.id.startsWith("new-")) setDeleted((d) => [...d, r.id]);
    setDirty(true);
  };

  const add = (c?: Client) => {
    setRows((rs) => [...rs, blankRow(c)]);
    setDirty(true);
  };

  const save = () =>
    start(async () => {
      const payload = rows.map((r) => ({
        id: r.id,
        client_id: r.client_id,
        client_name: r.client_name,
        product: r.product,
        note: r.note,
        afyp: parseAmount(r.afyp) ?? 0,
        revenue: parseAmount(r.revenue) ?? 0,
        commission: parseAmount(r.commission) ?? 0,
      }));
      const res = await saveBusinessAction(ym, payload, deleted);
      if (res.ok) {
        setDirty(false);
        setDeleted([]);
        setMsg({ ok: true, text: "已儲存" });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  const saveTarget = () =>
    start(async () => {
      const res = await saveTargetAction(ym, tNum);
      if (res.ok) {
        setTargetDirty(false);
        setTMsg({ ok: true, text: "已儲存目標" });
        router.refresh();
      } else setTMsg({ ok: false, text: res.error });
    });

  // 重新載入後用伺服器嘅資料（冇未儲存改動時）
  useEffect(() => {
    if (!dirty) setRows(cases.map(toEdit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases]);

  const notInTable = signedToAdd.filter((c) => !rows.some((r) => r.client_id === c.id));

  return (
    <div>
      <div className="biz-summary">
        <Progress label="Case" done={sum.cases} target={tNum.cases} money={false} />
        {MONEY_KEYS.map((k) => (
          <Progress key={k} label={MONEY_LABELS[k]} done={sum[k]} target={tNum[k]} money />
        ))}
      </div>

      <details className="card biz-target" open={targetOpenInit}>
        <summary>
          <b>本月目標（Target）</b>
          <span className="muted small"> — {readOnly ? "撳開查看" : "撳開設定"}</span>
        </summary>
        <div className="biz-target-grid">
          <label className="field">
            <span>Case 數</span>
            <input
              type="text"
              inputMode="numeric"
              value={target.cases}
              disabled={readOnly}
              onChange={(e) => {
                setTarget((t) => ({ ...t, cases: e.target.value.replace(/\D/g, "") }));
                setTargetDirty(true);
              }}
            />
          </label>
          {MONEY_KEYS.map((k) => (
            <label className="field" key={k}>
              <span>{MONEY_LABELS[k]}（HK$）</span>
              <input
                type="text"
                inputMode="decimal"
                value={target[k]}
                disabled={readOnly}
                onChange={(e) => {
                  setTarget((t) => ({ ...t, [k]: e.target.value }));
                  setTargetDirty(true);
                }}
              />
            </label>
          ))}
        </div>
        {!readOnly && (
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={saveTarget} disabled={pending || !targetDirty}>
              儲存目標
            </button>
            {tMsg && <span className={tMsg.ok ? "notice" : "error"}>{tMsg.text}</span>}
          </div>
        )}
      </details>

      {!readOnly && notInTable.length > 0 && (
        <div className="notice biz-suggest">
          Closing／Referral 未入生意表：
          {notInTable.map((c) => (
            <button key={c.id} className="btn btn-sm" onClick={() => add(c)}>
              ＋ {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="table-wrap" ref={tableRef}>
        <table className="biz-table" data-testid="biz-table">
          <thead>
            <tr>
              <th>#</th>
              <th>客名</th>
              <th>產品</th>
              <th className="num">AFYP</th>
              <th className="num">Revenue</th>
              <th className="num">佣金</th>
              <th>備註</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  本月未有生意{readOnly ? "" : "，撳下面「＋ 新增一單」"}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} data-testid="biz-row">
                <td className="muted biz-no">{i + 1}</td>
                <td data-label="客名">
                  <input
                    type="text"
                    list="biz-clients"
                    aria-label={`第 ${i + 1} 單客名`}
                    value={r.client_name}
                    disabled={readOnly}
                    onChange={(e) => edit(r.id, "client_name", e.target.value)}
                  />
                  {r.client_id && <div className="small pos">已連客戶卡</div>}
                </td>
                <td data-label="產品">
                  <input type="text" aria-label={`第 ${i + 1} 單產品`} value={r.product} disabled={readOnly} onChange={(e) => edit(r.id, "product", e.target.value)} />
                </td>
                {MONEY_KEYS.map((k) => (
                  <td key={k} className="num" data-label={MONEY_LABELS[k]}>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={`money${parsed[i][k] === null ? " bad" : ""}`}
                      aria-label={`第 ${i + 1} 單${MONEY_LABELS[k]}`}
                      value={r[k]}
                      placeholder="0"
                      disabled={readOnly}
                      onChange={(e) => edit(r.id, k, e.target.value)}
                    />
                  </td>
                ))}
                <td data-label="備註">
                  <input type="text" aria-label={`第 ${i + 1} 單備註`} value={r.note} disabled={readOnly} onChange={(e) => edit(r.id, "note", e.target.value)} />
                </td>
                {!readOnly && (
                  <td className="biz-del">
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r)} aria-label={`刪除第 ${i + 1} 單`}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>本月合計（{sum.cases} 單）</td>
              {MONEY_KEYS.map((k) => (
                <td key={k} className="num" data-testid={`sum-${k}`} data-label={MONEY_LABELS[k]}>
                  {hkd(sum[k])}
                </td>
              ))}
              <td colSpan={readOnly ? 1 : 2} />
            </tr>
          </tfoot>
        </table>
        <datalist id="biz-clients">
          {clients.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
      </div>

      {!readOnly && (
        <div className="savebar">
          <button className="btn" onClick={() => add()}>
            ＋ 新增一單
          </button>
          <button className="btn btn-primary" onClick={save} disabled={pending || !dirty || invalid}>
            {pending ? "儲存中…" : "儲存"}
          </button>
          {invalid && <span className="error">有金額格式唔啱（例：12000 或 1.2萬）</span>}
          {msg && <span className={msg.ok ? "notice" : "error"}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
