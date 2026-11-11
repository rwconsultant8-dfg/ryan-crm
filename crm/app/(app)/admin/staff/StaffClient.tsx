"use client";

import { useActionState, useState, useTransition } from "react";
import { createStaffAction, renameAction, resetPasswordAction, setActiveAction, setTelegramAction, type StaffResult } from "./actions";

type Staff = { id: string; email: string; full_name: string; role: string; active: boolean; telegram_id: string | null };

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  const pw = Array.from(arr, (n) => chars[n % chars.length]).join("");
  return /\d/.test(pw) ? pw : pw.slice(0, 11) + "7";
}

export function CreateStaffForm() {
  const [state, action, pending] = useActionState<StaffResult, FormData>(createStaffAction, null);
  const [pw, setPw] = useState("");
  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>開新員工帳戶</h2>
      <div className="grid-2">
        <label className="field">
          <span>姓名</span>
          <input type="text" name="full_name" required />
        </label>
        <label className="field">
          <span>電郵（登入用）</span>
          <input type="email" name="email" required />
        </label>
        <label className="field">
          <span>臨時密碼（最少 10 位，要有字母同數字）</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input type="text" name="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
            <button type="button" className="btn btn-sm" onClick={() => setPw(randomPassword())}>
              隨機
            </button>
          </div>
        </label>
      </div>
      {state && <p className={state.ok ? "notice" : "error"}>{state.message}</p>}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "開設中…" : "開帳戶"}
      </button>
    </form>
  );
}

export function StaffTable({ staff, meId }: { staff: Staff[]; meId: string }) {
  const [msg, setMsg] = useState<StaffResult>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<StaffResult>) => start(async () => setMsg(await fn()));

  return (
    <>
      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>電郵</th>
              <th>Telegram</th>
              <th>角色</th>
              <th>狀態</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.full_name || "—"}</td>
                <td>{s.email}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    disabled={pending}
                    title="綁定員工嘅 Telegram 帳戶 ID"
                    onClick={() => {
                      const v = prompt("Telegram 數字帳戶 ID（由員工私訊助手 /start 取得）。留空 = 解除綁定", s.telegram_id ?? "");
                      if (v !== null) run(() => setTelegramAction(s.id, v));
                    }}
                  >
                    {s.telegram_id ? s.telegram_id : "設定"}
                  </button>
                </td>
                <td>{s.role === "admin" ? "主管" : "員工"}</td>
                <td>{s.active ? <span className="badge badge-green">啟用中</span> : <span className="badge badge-red">已停用</span>}</td>
                <td>
                  {s.id === meId ? (
                    <span className="muted small">（你自己）</span>
                  ) : (
                    <div className="row">
                      {s.active ? (
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={pending}
                          onClick={() => {
                            if (confirm(`確定停用 ${s.full_name || s.email}？佢會即時登入唔到，亦睇唔到任何客。佢嘅客會保留，主管仍然睇得到。`))
                              run(() => setActiveAction(s.id, false));
                          }}
                        >
                          停用
                        </button>
                      ) : (
                        <button className="btn btn-sm" disabled={pending} onClick={() => run(() => setActiveAction(s.id, true))}>
                          重新啟用
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        disabled={pending}
                        onClick={() => {
                          const name = prompt("新姓名", s.full_name);
                          if (name !== null) run(() => renameAction(s.id, name));
                        }}
                      >
                        改名
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={pending}
                        onClick={() => {
                          const pw = prompt("輸入新臨時密碼（最少 10 位，要有字母同數字）", randomPassword());
                          if (pw) run(() => resetPasswordAction(s.id, pw));
                        }}
                      >
                        重設密碼
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
