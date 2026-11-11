"use client";
import {ageLabel} from "@/lib/age";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { deleteClientAction, moveStageAction, saveFormAction, updateInfoAction, type ActionResult } from "@/app/(app)/clients/actions";
import InfoFields from "./InfoFields";
import { CLIENT_FORMS, factFindingChecklist, historicalFormEntries, pointFormLines } from "@/lib/client-forms";
import { type SeasonColumn } from "@/lib/seasons";
import {
  GENDERS,
  MARITAL,
  formFieldKeys,
  STAGES,
  type Checks,
  type FormColumn,
  type Stage,
} from "@/lib/stages";

type Info = { name: string; age: string; gender: string; occupation: string; marital: string; customer_type?: string };

export type EditorClient = {
  id: string;
  stage: Stage;
  season: SeasonColumn;
  info: Info;
  checks: Checks;
  forms: Record<FormColumn, Record<string, string>>;
};

type Tab = "info" | Stage;
type DirtyKey = "info" | FormColumn;

export function ClientStageForm({ phase, forms, info = {}, readOnly, onChange }: {
  phase: Stage;
  forms: EditorClient["forms"];
  info?: Record<string, string | undefined>;
  readOnly: boolean;
  onChange: (column: FormColumn, key: string, value: string) => void;
}) {
  const history = historicalFormEntries(phase, forms);
  const checklist = phase === "MEETING" ? factFindingChecklist(info, forms) : [];
  return (
    <>
      {phase === "MEETING" && (
        <section className="client-fact-checklist" aria-label="Fact Finding 資料 checklist">
          <h2>資料 checklist</h2>
          <p className="muted small">已填資料會自動打 tick · {checklist.filter((item) => item.complete).length} / {checklist.length}</p>
          <ul className="client-check-grid">
            {checklist.map((item) => (
              <li key={item.key} className={item.complete ? "complete" : ""}>
                <span aria-hidden="true">{item.complete ? "☑️" : "☐"}</span>
                <span>{item.label}<span className="sr-only">：{item.complete ? "已有資料" : "未填資料"}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {CLIENT_FORMS.filter((def) => def.phase === phase).map((def) => (
        <section key={def.column} className="client-form-group">
          <h2 style={{ marginTop: 0 }}>{def.title}</h2>
          <p className="muted small">{def.timing}</p>
          {def.sections.map((section, index) => (
            <fieldset key={index} className={`client-simple-fields client-fieldset${section.fields.every((field) => field.type === "checkbox") ? " client-product-options" : ""}`}>
              {section.title && <legend>{section.title}</legend>}
              {section.note && <p className="muted small">{section.note}</p>}
              {section.fields.map((field) => (
                field.type === "checkbox" ? (
                  <label className="client-product-option" key={field.key}>
                    <input type="checkbox" checked={forms[def.column]?.[field.key] === "true"} disabled={readOnly}
                      onChange={(event) => onChange(def.column, field.key, event.target.checked ? "true" : "")} />
                    <span>{field.label}</span>
                  </label>
                ) : <div className="field" key={field.key}>
                <label htmlFor={`client-${def.column}-${field.key}`}>
                  <span>{field.label}</span>
                </label>
                  {field.hint && <p className="muted small" id={`client-hint-${field.key}`}>{field.hint}</p>}
                  <textarea
                    id={`client-${def.column}-${field.key}`}
                    aria-describedby={field.hint ? `client-hint-${field.key}` : undefined}
                    rows={field.type === "points" ? 6 : field.key === "notes" ? 8 : 3}
                    placeholder={field.type === "points" ? "每行一項留意事項" : undefined}
                    maxLength={5000}
                    value={forms[def.column]?.[field.key] ?? ""}
                    disabled={readOnly}
                    onChange={(event) => onChange(def.column, field.key, event.target.value)}
                  />
                  {field.type === "points" && pointFormLines(forms[def.column]?.[field.key] ?? "").length > 0 && (
                    <ul className="client-point-list" aria-label={`${field.label}逐點顯示`}>
                      {pointFormLines(forms[def.column]?.[field.key] ?? "").map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </fieldset>
          ))}
        </section>
      ))}
      {history.length > 0 && (
        <details className="history">
          <summary>過往記錄（{history.length}）</summary>
          <dl className="client-form-history">
            {history.map((entry) => (
              <div key={entry.key}>
                <dt className="muted small">{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}

export default function ClientEditor({ client, readOnly }: { client: EditorClient; readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("info");
  const [info, setInfo] = useState<Info>(client.info);
  const [forms, setForms] = useState(client.forms);
  const [stage, setStage] = useState<Stage>(client.stage);
  const [dirty, setDirty] = useState<Map<DirtyKey, Set<string>>>(new Map());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // 有未儲存嘢時離開頁面要提醒
  useEffect(() => {
    if (dirty.size === 0) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const markDirty = (t: DirtyKey, key: string) => setDirty((d) => {
    const next = new Map(d);
    next.set(t, new Set(d.get(t)).add(key));
    return next;
  });
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

  const clearDirty = (t: DirtyKey, keys?: string[]) =>
    setDirty((d) => {
      const n = new Map(d);
      if (keys) {
        const remaining = new Set(d.get(t));
        for (const key of keys) remaining.delete(key);
        if (remaining.size) n.set(t, remaining);
        else n.delete(t);
      } else n.delete(t);
      return n;
    });

  const save = () => {
    if (tab === "info") {
      const changed = Object.fromEntries([...(dirty.get("info") ?? [])].map((key) => [key, info[key as keyof Info] ?? ""]));
      run(() => updateInfoAction(client.id, changed), () => clearDirty("info"));
      return;
    }
    const changed = CLIENT_FORMS.filter((f) => f.phase === tab && formFieldKeys(f).some((key) => dirty.get(f.column)?.has(key)));
    run(async () => {
      for (const def of changed) {
        const values = Object.fromEntries(formFieldKeys(def).filter((key) => dirty.get(def.column)?.has(key)).map((key) => [key, forms[def.column]?.[key] ?? ""]));
        const result = await saveFormAction(client.id, def.stage, values, {});
        if (!result.ok) return result;
        clearDirty(def.column, Object.keys(values));
      }
      return { ok: true };
    });
  };

  const changeStage = (to: Stage) => {
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

  const remove = () => {
    if (!window.confirm(`確定永久刪除「${client.info.name}」？刪除後無法復原（審計記錄會保留刪除紀錄）。`)) return;
    run(() => deleteClientAction(client.id));
  };

  const setField = (col: FormColumn, key: string, v: string) => {
    setForms((f) => ({ ...f, [col]: { ...f[col], [key]: v } }));
    markDirty(col, key);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "info", label: "基本資料" },
    ...STAGES.map((phase) => ({
      key: phase.key as Tab, label: phase.label,
    })),
  ];
  const tabDirty = (key: Tab) => key === "info" ? dirty.has("info") : CLIENT_FORMS.some((form) => form.phase === key && formFieldKeys(form).some((field) => dirty.get(form.column)?.has(field)));
  const genderText = GENDERS.find((g) => g.value === info.gender)?.label;
  const maritalText = MARITAL.find((m) => m.value === info.marital)?.label;
  const meta = [info.age && ageLabel(info.age), genderText, info.occupation, maritalText].filter(Boolean).join(" · ");

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
            <select value={stage} disabled={readOnly || pending} onChange={(e) => changeStage(e.target.value as Stage)} aria-label="階段">
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.short}
                </option>
              ))}
            </select>
          </label>

        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="客戶資料">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`client-tab-${t.key}`}
            aria-controls="client-tab-panel"
            aria-selected={tab === t.key}
            disabled={pending}
            className={`tab${tab === t.key ? " active" : ""}`}
            onClick={() => {
              setTab(t.key);
              setMsg(null);
            }}
          >
            {t.label}
            {tabDirty(t.key) && <span className="dot" title="未儲存" />}
          </button>
        ))}
      </div>

      <div className="card" role="tabpanel" id="client-tab-panel" aria-labelledby={`client-tab-${tab}`}>
        {tab === "info" ? (
          <InfoFields
            value={info}
            disabled={readOnly || pending}
            onChange={(v) => {
              setInfo(v);
              for (const key of Object.keys(v) as (keyof Info)[]) if (v[key] !== info[key]) markDirty("info", key);
            }}
          />
        ) : (
          <ClientStageForm phase={tab} forms={forms} info={info} readOnly={readOnly || pending} onChange={setField} />
        )}

        {!readOnly && (
          <div className="savebar">
            <button className="btn btn-primary" onClick={save} disabled={pending || !tabDirty(tab)}>
              {pending ? "儲存中…" : "儲存"}
            </button>
            {msg && <span className={msg.ok ? "notice" : "error"}>{msg.text}</span>}
            <span className="spacer" />
            {tab === "info" && (
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
