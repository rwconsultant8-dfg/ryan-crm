"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteClientAction, moveSeasonAction, moveStageAction, saveFormAction, type ActionResult } from "@/app/(app)/clients/actions";
import InfoFields from "./InfoFields";
import { NO_SEASON, SEASONS, type SeasonColumn } from "@/lib/seasons";
import {
  FOLLOW_UPS,
  CLIENT_FORMS,
  INFO_KEYS,
  INFO_LABELS,
  GENDERS,
  MARITAL,
  MEETING_TIPS,
  formFieldKeys,
  PIPELINE_STAGES,
  isClosedStage,
  missingChecks,
  proposalUrl,
  stageLabel,
  type CheckKey,
  type Checks,
  type Field,
  type ClientFormColumn,
  type ClientFormDef,
  type FollowUp,
  type PipelineStage,
} from "@/lib/stages";

type Info = { name: string; age: string; gender: string; occupation: string; marital: string };

export type EditorClient = {
  id: string;
  stage: PipelineStage;
  season: SeasonColumn;
  info: Info;
  checks: Checks;
  forms: Record<ClientFormColumn, Record<string, string>>;
};

type Tab = ClientFormColumn | FollowUp;
type EditableSection = Tab | "info";

function FieldInput({
  f,
  value,
  onChange,
  disabled,
}: {
  f: Field;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  if (f.type === "rating") {
    return (
      <div className="rating" role="radiogroup" aria-label={f.label}>
        {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
          <button
            type="button"
            key={n}
            className={value === n ? "on" : undefined}
            disabled={disabled}
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? "" : n)}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }
  if (f.type === "checkbox") {
    return <input type="checkbox" checked={value === "true"} disabled={disabled} onChange={(e) => onChange(e.target.checked ? "true" : "")} />;
  }
  if (f.type === "text" || f.type === "number" || f.type === "date" || f.type === "url") {
    return (
      <input
        type={f.type === "number" ? "text" : f.type}
        inputMode={f.type === "number" ? "decimal" : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <textarea rows={2} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

export default function ClientEditor({ client, readOnly }: { client: EditorClient; readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("form_rr");
  const [info, setInfo] = useState<Info>(client.info);
  const [forms, setForms] = useState(client.forms);
  const [checks, setChecks] = useState<Checks>(client.checks);
  const [stage, setStage] = useState<PipelineStage>(client.stage);
  const [season, setSeason] = useState<SeasonColumn>(client.season);
  const [dirty, setDirty] = useState<Set<EditableSection>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // 有未儲存嘢時離開頁面要提醒
  useEffect(() => {
    if (dirty.size === 0) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const markDirty = (t: EditableSection) => setDirty((d) => new Set(d).add(t));
  const missing = useMemo(() => missingChecks(checks), [checks]);
  const ready = missing.length === 0;
  const checksDirty = dirty.has("form_rr") || dirty.has("form_nr2");

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ ok: true, text: "已儲存" });
        onOk?.();
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  const activeFollowUp = FOLLOW_UPS.find((item) => item.key === tab)?.key;
  const activeForm = CLIENT_FORMS.find((f) => f.column === (activeFollowUp ? "form_pc" : tab))!;
  const infoDirty = tab === "form_rr" && dirty.has("info");

  const save = () => {
    const cs: Partial<Record<CheckKey, boolean>> = {};
    for (const c of activeForm.checks?.items ?? []) cs[c.key] = checks[c.key];
    const values = dirty.has(tab) ? forms[activeForm.column] : null;
    run(
      () => saveFormAction(client.id, activeForm.stage, values, cs, activeFollowUp, infoDirty ? info : undefined),
      () => setDirty((previous) => {
        const saved = new Set(previous);
        saved.delete(tab);
        if (infoDirty) saved.delete("info");
        return saved;
      }),
    );
  };

  const changeStage = (to: PipelineStage) => {
    if (isClosedStage(to) && !ready) {
      if (!window.confirm(`仲差 ${missing.length} 格先具備簽單條件，確定移去「${PIPELINE_STAGES.find((s) => s.key === to)?.label}」？`)) return;
    }
    const prev = stage;
    setStage(to);
    setMsg(null);
    startTransition(async () => {
      const res = await moveStageAction(client.id, to);
      if (!res.ok) {
        setStage(prev);
        setMsg({ ok: false, text: res.error });
      } else {
        setMsg({ ok: true, text: "已轉階段" });
        router.refresh();
      }
    });
  };

  const changeSeason = (to: SeasonColumn) => {
    const prev = season;
    setSeason(to);
    setMsg(null);
    startTransition(async () => {
      const res = await moveSeasonAction(client.id, to === NO_SEASON ? null : to);
      if (!res.ok) {
        setSeason(prev);
        setMsg({ ok: false, text: res.error });
      } else {
        setMsg({ ok: true, text: "已更新四季" });
        router.refresh();
      }
    });
  };

  const remove = () => {
    if (!window.confirm(`確定永久刪除「${client.info.name}」？刪除後無法復原（審計記錄會保留刪除紀錄）。`)) return;
    run(() => deleteClientAction(client.id));
  };

  const setField = (col: ClientFormColumn, key: string, v: string, activeTab: Tab = col) => {
    setForms((f) => ({ ...f, [col]: { ...f[col], [key]: v } }));
    markDirty(activeTab);
  };

  const renderForm = (def: ClientFormDef, followUp?: FollowUp) => {
    const values = forms[def.column] ?? {};
    const linkedProposal = proposalUrl(client.forms.form_pc.proposal_url ?? "");
    return (
      <div>
        {!followUp && (
          <p className="muted small" style={{ marginTop: 0 }}>
            <b>{def.title}</b> — {def.timing}
          </p>
        )}
        {def.stage === "RR" && (
          <section className="form-section">
            <h3>基本資料</h3>
            <div className="grid-2">
              <InfoFields
                value={info}
                disabled={readOnly || pending}
                onChange={(value) => {
                  setInfo(value);
                  markDirty("info");
                }}
              />
              <fieldset className="checklist">
                <legend>基本資料 Checklist</legend>
                {INFO_KEYS.map((key) => (
                  <label className="check-row" key={key}>
                    <input type="checkbox" checked={Boolean(info[key].trim())} disabled />
                    <span>{INFO_LABELS[key]}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </section>
        )}
        {def.tips && (
          <ul className="form-tips">
            {def.tips.map((t) => (
              <li key={t}>＊{t}</li>
            ))}
          </ul>
        )}
        {def.sections.filter((section) => section.followUp === followUp).map((s, i) => (
          <section key={i} className="form-section">
            {s.title && <h3>{s.title}</h3>}
            {s.note && <div className="section-note">{s.note}</div>}
            <div className={s.fields.some((f) => f.type === "rating") ? undefined : "form-grid"}>
              {s.fields.map((f) => (
                f.type === "checkbox" ? (
                  <label className="check-row" key={f.key}>
                    <FieldInput f={f} value={values[f.key] ?? ""} disabled={readOnly || pending} onChange={(v) => setField(def.column, f.key, v)} />
                    <span>{f.label}</span>
                  </label>
                ) : (
                  <div key={f.key}>
                    <label className="field">
                      <span>
                        {f.label}
                        {f.hint && <em className="field-hint">{f.hint}</em>}
                      </span>
                      <FieldInput f={f} value={values[f.key] ?? ""} disabled={readOnly || pending} onChange={(v) => setField(def.column, f.key, v, followUp ?? def.column)} />
                      {f.type === "notes" && <small className="muted">每行一點</small>}
                    </label>
                    {f.type === "url" && linkedProposal && (
                      <a href={linkedProposal} target="_blank" rel="noopener noreferrer">開啟計劃書</a>
                    )}
                    {f.type === "notes" && values[f.key]?.trim() && (
                      <ul>
                        {values[f.key].split("\n").filter((line) => line.trim()).map((line, index) => <li key={index}>{line.trim()}</li>)}
                      </ul>
                    )}
                  </div>
                )
              ))}
            </div>
          </section>
        ))}
        {def.checks && (
          <div className="checklist">
            <h3 style={{ marginTop: 0 }}>{def.checks.title}</h3>
            {def.checks.items.map((c) => (
              <div className="check-row" key={c.key}>
                <input
                  type="checkbox"
                  id={c.key}
                  checked={checks[c.key]}
                  disabled={readOnly || pending}
                  onChange={(e) => {
                    setChecks((x) => ({ ...x, [c.key]: e.target.checked }));
                    markDirty(def.column);
                  }}
                />
                <label className="label" htmlFor={c.key}>
                  {c.label}
                </label>
                {c.fill && (
                  <div className="fill">
                    <FieldInput
                      f={{ ...c.fill, type: c.fill.type ?? "text" }}
                      value={values[c.fill.key] ?? ""}
                      disabled={readOnly || pending}
                      onChange={(v) => setField(def.column, c.fill!.key, v)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const filled = (col: ClientFormColumn) => {
    const def = CLIENT_FORMS.find((f) => f.column === col)!;
    const keys = formFieldKeys({ ...def, sections: def.sections.filter((section) => !section.followUp) });
    return { n: keys.filter((k) => (forms[col]?.[k] ?? "").trim() !== "").length, total: keys.length };
  };
  const tabs: { key: Tab; label: string; count?: string }[] = [
    ...CLIENT_FORMS.map((f) => {
      const c = filled(f.column);
      return { key: f.column, label: stageLabel(f.stage), count: `${c.n}/${c.total}` };
    }),
    ...FOLLOW_UPS.map(({ key, label }) => ({ key, label })),
  ];
  const genderText = GENDERS.find((g) => g.value === info.gender)?.label;
  const maritalText = MARITAL.find((m) => m.value === info.marital)?.label;
  const meta = [info.age && `${info.age}歲`, genderText, info.occupation, maritalText].filter(Boolean).join(" · ");
  const doneChecks = 8 - missing.length;

  return (
    <div>
      <div className="card client-head">
        <div className="client-title">
          <h1>{client.info.name || "（未命名）"}</h1>
          {meta && <div className="muted small">{meta}</div>}
        </div>
        <div className="client-controls">
          <label className="ctl">
            <span>階段</span>
            <select value={stage} disabled={readOnly || pending} onChange={(e) => changeStage(e.target.value as PipelineStage)} aria-label="階段">
              {PIPELINE_STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ctl">
            <span>四季</span>
            <select
              value={season}
              disabled={readOnly || pending}
              onChange={(e) => changeSeason(e.target.value as SeasonColumn)}
              aria-label="四季"
            >
              <option value={NO_SEASON}>未分類</option>
              {SEASONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.emoji} {s.label}（{s.focus}）
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={`readiness${ready ? " ok" : ""}`} data-testid="ready-box">
          <div className="row">
            <b>{ready ? "✅ 具備簽單條件" : `簽單條件 ${doneChecks}/8 · 仲差 ${missing.length} 格`}</b>
            {checksDirty && <span className="muted small">（未儲存）</span>}
          </div>
          <div className="progress" aria-hidden>
            <div style={{ width: `${(doneChecks / 8) * 100}%` }} />
          </div>
          {!ready && (
            <div className="chips">
              {missing.map((m) => (
                <span key={m.label} className="chip">
                  {stageLabel(m.stage)}・{m.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="muted small" style={{ margin: "12px 0 0" }}>{MEETING_TIPS}</p>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? " active" : ""}`}
            onClick={() => {
              setTab(t.key);
              setMsg(null);
            }}
          >
            {t.label}
            {t.count && <span className="tab-count" aria-hidden="true">{t.count}</span>}
            {(dirty.has(t.key) || (t.key === "form_rr" && dirty.has("info"))) && <span className="dot" title="未儲存" />}
          </button>
        ))}
      </div>

      <div className="card">
        {renderForm(activeForm, activeFollowUp)}

        {!readOnly && (
          <div className="savebar">
            <button className="btn btn-primary" onClick={save} disabled={pending || (!dirty.has(tab) && !infoDirty)}>
              {pending ? "儲存中…" : "儲存"}
            </button>
            {msg && <span className={msg.ok ? "notice" : "error"}>{msg.text}</span>}
            <span className="spacer" />
            {tab === "form_rr" && (
              <button className="btn btn-danger btn-sm" onClick={remove} disabled={pending}>
                刪除客戶
              </button>
            )}
          </div>
        )}
        {readOnly && msg && !msg.ok && <p className="error">{msg.text}</p>}
      </div>
    </div>
  );
}
