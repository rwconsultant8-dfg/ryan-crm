import "server-only";
import {normalizeAge,ageLabel} from "../age";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPT_SLOTS } from "../activity";
import { apptRecordId } from "../activity-data";
import { decryptColumn, encryptColumn } from "../secure";
import { ALL_CHECKS, FORMS, GENDERS, MARITAL, stageLabel, type FormColumn } from "../stages";
import { SEASONS, normalizeSeason, pipelinePatch } from "../seasons";
import {readContactHistory} from "../followups";
import { shortDate } from "../weeks";
import { CATEGORIES, PLAN_STAGES, STATUSES } from "../planner";
import type { PreparedTask } from "./tasks";
import {hasClientFacts} from "./content";
import type { Extraction } from "./schema";

export type ClientTarget =
  | { mode: "none" }
  | { mode: "existing"; id: string; name: string }
  | { mode: "new"; id: string; name: string }
  | { mode: "ambiguous"; name: string; candidates: string[] };

export type Draft = {
  channel?: "telegram" | "whatsapp" | "app"; texts: string[]; today: string; extraction: Extraction; target: ClientTarget; taskItems?: PreparedTask[] };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 喺員工自己嘅客入面搵名：完全相同優先，其次互相包含（例如「陳大文」同「陳大文先生」） */
export function matchClient(name: string, clients: { id: string; name: string }[]): ClientTarget {
  const n = norm(name);
  if (!n) return { mode: "none" };
  const exact = clients.filter((c) => norm(c.name) === n);
  if (exact.length === 1) return { mode: "existing", id: exact[0].id, name: exact[0].name };
  const partial = exact.length > 1 ? exact : clients.filter((c) => norm(c.name).includes(n) || n.includes(norm(c.name)));
  if (partial.length === 1) return { mode: "existing", id: partial[0].id, name: partial[0].name };
  if (partial.length > 1) return { mode: "ambiguous", name, candidates: partial.map((c) => c.name) };
  return { mode: "new", id: randomUUID(), name: name.trim() };
}

export async function loadClientNames(admin: SupabaseClient, ownerId: string) {
  const { data, error } = await admin.from("clients").select("id, info").eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id as string, name: decryptColumn(c.id, "info", c.info).name ?? "" }));
}

const fieldMeta = (() => {
  const m = new Map<string, { label: string; append: boolean; number: boolean; checkbox?: boolean }>();
  for (const f of FORMS) {
    for (const s of f.sections)
      for (const x of s.fields)
        m.set(`${f.column}.${x.key}`, {
          label: `${f.title}・${x.label}`,
          append: x.type === "textarea" || x.type === "points" || x.type === undefined,
          number: x.type === "number",
          checkbox: x.type === "checkbox",
        });
    for (const c of f.checks?.items ?? [])
      if (c.fill) m.set(`${f.column}.${c.fill.key}`, { label: `${f.title}・${c.fill.label}`, append: false, number: false });
  }
  return m;
})();

const NUM = /^-?\d+(\.\d+)?$/;

/** 草稿嘅內容有冇任何可以寫入嘅嘢 */
export function hasContent(d: Draft): boolean {
  const e = d.extraction;
  return (
    Boolean(e.tasks?.length) ||
    d.target.mode === "existing" ||
    d.target.mode === "new" ||
    (e.appointment.slot !== "" && e.appointment.text.trim() !== "")
  );
}

/** 俾員工睇嘅確認訊息 */
export function describeDraft(d: Draft): string {
  const e = d.extraction;
  if (e.tasks?.some(t=>t.operation==="reschedule") && !e.meeting?.occurred) {
    const changes = d.taskItems?.filter(t=>t.rescheduledFrom).map(t=>{
      const info=decryptColumn(t.id,"info",t.info),from=t.rescheduledFrom!;
      return `${info.name}\n原定：${from.day}${from.time ? ` ${from.time}` : ""}\n改為：${t.day}${info.time ? ` ${info.time}` : ""}\n安排：${info.plan}`;
    }) || [];
    const others=(e.tasks || []).filter(t=>t.operation!=="reschedule").map(t=>`${t.day} · ${t.name}：${t.plan}（${STATUSES[t.status]}）`);
    return ["改期預覽（未儲存）：",...changes,...others,"確認後會取消舊安排，加入新安排，並保留原記錄。","回覆「確認」儲存，「取消」放棄；想補充就直接再講。"].join("\n\n");
  }
  if (e.tasks?.length && !e.meeting?.occurred && !hasClientFacts(e)) return ["幫你整理咗（未儲存）：", ...e.tasks.map(t =>
    `${t.day}${t.time ? ` ${t.time}` : ""} · ${CATEGORIES[t.category]} · ${t.name}\n${PLAN_STAGES[t.stage]}｜${STATUSES[t.status]}\n計劃：${t.plan}${t.result ? `\n結果：${t.result}` : ""}`),
    "今次只更新待辦；預計 stage 唔會改動客戶目前進度。", "回覆「確認」儲存，「取消」放棄；想補充就直接再講。"].join("\n\n");
  const lines: string[] = ["📝 幫你整理咗（未儲存）："];
  if (d.target.mode === "existing") {
    lines.push(`客戶：${d.target.name}`);
    const basic=[e.client.age && `年齡：${ageLabel(e.client.age)}`,e.client.gender && `性別：${GENDERS.find(g=>g.value===e.client.gender)?.label || ""}`,e.client.occupation && `職業：${e.client.occupation}`,e.client.marital && `婚姻狀況：${MARITAL.find(m=>m.value===e.client.marital)?.label || ""}`].filter(Boolean);
    if(basic.length)lines.push(`\n【基本資料（空白欄位會補填）】\n${basic.join("\n")}`);
  }
  if (d.target.mode === "new") {
    const meta = [
      e.client.age && ageLabel(e.client.age),
      GENDERS.find((g) => g.value === e.client.gender)?.label,
      e.client.occupation,
      MARITAL.find((m) => m.value === e.client.marital)?.label,
    ].filter(Boolean);
    lines.push(`客戶：${d.target.name}（🆕 新客${meta.length ? `，${meta.join("・")}` : ""}）`);
  }
  if (d.target.mode !== "none" && d.target.mode !== "ambiguous") {
    for (const f of e.fields) {
      const meta = fieldMeta.get(f.field);
      if (meta && f.text.trim()) lines.push(`\n【${meta.label}】\n${f.text.trim()}`);
    }
    const checks = ALL_CHECKS.filter((c) => e.checks.includes(c.key));
    if (checks.length) lines.push(`\n✅ 簽單條件：${checks.map((c) => c.label).join("、")}`);
    if (e.stage) lines.push(`➡️ 階段：${stageLabel(e.stage)}`);
    if (e.season) {
      const s = SEASONS.find((x) => x.key === normalizeSeason(e.season))!;
      lines.push(`${s.emoji} 人脈分類：${s.label}`);
    }
  }
  if(e.meeting?.occurred){
    lines.push(`\n【見客後整理 · ${e.date}】\n${e.meeting.summary || e.summary}`);
    if(e.meeting.response)lines.push(`客戶反應：${e.meeting.response}`);
    if(e.meeting.blocker)lines.push(`卡住原因：${e.meeting.blocker}`);
    if(e.meeting.needs_help)lines.push("需要 Ryan 協助");
    lines.push(`下一步：${e.meeting.next_step || "未交代"}\n日期：${e.meeting.next_day || "未定，請補充"}`);
    if(e.tasks?.length)lines.push(`\n【同步加入待辦】\n${e.tasks.map(t=>`${t.day}${t.time ? ` ${t.time}` : ""} · ${t.name}：${t.plan}`).join("\n")}`);
  }
  if(e.tasks?.length && !e.meeting?.occurred)lines.push(`\n【下一步安排】\n${e.tasks.map(t=>`${t.day}${t.time?` ${t.time}`:""} · ${t.name}：${t.plan}`).join("\n")}`);
  if (e.appointment.slot) {
    lines.push(`\n📅 日曆（${shortDate(e.date)}）`);
    if (e.appointment.slot && e.appointment.text.trim()) {
      const slot = APPT_SLOTS.find((s) => s.key === e.appointment.slot)!;
      lines.push(`🍽 ${slot.label} appointment：${e.appointment.text.trim()}`);
    }
  }
  lines.push("\n回覆「確認」儲存，「取消」放棄；想補充就直接再講。");
  return lines.join("\n");
}

const stamp = (date: string) => `〔${shortDate(date)}〕`;

/** 將草稿寫入資料庫（經 service role 嘅 wa_* 函數，以員工身份寫入並記審計） */
export async function applyDraft(admin: SupabaseClient, ownerId: string, d: Draft, draftId?: string): Promise<void> {
  const e = d.extraction;

  if (e.tasks?.length && !e.meeting?.occurred && !hasClientFacts(e)) {
    if (!draftId || !d.taskItems?.length) throw new Error("請重新提交待辦訊息，再確認。");
    const { error } = await admin.rpc("wa_save_tasks", { p_actor: ownerId, p_draft: draftId, p_items: d.taskItems });
    if (error) throw new Error("待辦儲存失敗，請重新整理或稍後再試。");
    return;
  }
  if (d.target.mode === "existing" || d.target.mode === "new") {
    const id = d.target.id;
    let row: Record<string, unknown> = {};
    if((e.meeting?.occurred || hasClientFacts(e) && e.tasks?.length) && draftId){
      const {data,error}=await admin.from("clients").select("*").eq("id",id).eq("owner_id",ownerId).maybeSingle();
      if(error || (!data && d.target.mode==="existing"))throw new Error("未能核對客戶或之前嘅見客記錄，請稍後再試。");
      if(data)row=data;
    }else if (d.target.mode === "existing") {
      const { data, error } = await admin.from("clients").select("*").eq("id", id).eq("owner_id", ownerId).single();
      if (error || !data) throw new Error("搵唔到呢個客");
      row = data;
    }

    const patch: Record<string, unknown> = {};

    // 基本資料：新客全部填；舊客只補空白
    const curInfo = decryptColumn(id, "info", row.info as Record<string, string>);
    const alreadyRecorded=Boolean((e.meeting?.occurred || hasClientFacts(e) && e.tasks?.length) && draftId && readContactHistory(curInfo.contact_history).some(event=>event.id===draftId));
    const nextInfo: Record<string, string> = {};
    const want: Record<string, string> = {
      name: d.target.name,
      age: normalizeAge(e.client.age) || "",
      gender: e.client.gender,
      occupation: e.client.occupation.slice(0, 200),
      marital: e.client.marital,
    };
    for (const [k, v] of Object.entries(want)) if (v && !curInfo[k]) nextInfo[k] = v;
    if (e.client.customer_type) nextInfo.customer_type = e.client.customer_type;
    if((e.meeting?.occurred || hasClientFacts(e) && e.tasks?.length) && draftId && !alreadyRecorded){
      const history=readContactHistory(curInfo.contact_history);
      if(curInfo.contact_history){try{if(JSON.parse(curInfo.contact_history).length!==history.length)throw Error();}catch{throw new Error("歷史記錄格式未能核對，未有覆蓋原有內容。");}}
      history.push({id:draftId,at:new Date().toISOString(),day:e.date,kind:e.meeting?.occurred?"contact":"note",text:e.meeting?.summary || e.summary,meeting:e.meeting?.occurred?e.meeting:undefined,source:d.channel || "whatsapp"});
      const serialized=JSON.stringify(history);if(serialized.length>250000)throw new Error("見客記錄已達容量上限，請先保留歷史再處理。");
      nextInfo.contact_history=serialized;
      if(e.meeting?.occurred && e.date>(curInfo.last_contact_at||""))nextInfo.last_contact_at=e.date;
    }
    if (Object.keys(nextInfo).length) patch.info = encryptColumn(id, "info", row.info as Record<string, string>, nextInfo);

    // 表格：長文字欄位加喺原有內容後面（標日期），其他欄位直接更新
    const byColumn = new Map<FormColumn, Record<string, string>>();
    for (const f of e.fields) {
      const meta = fieldMeta.get(f.field);
      const text = f.text.trim().slice(0, 5000);
      if (!meta || !text) continue;
      if (meta.checkbox && text !== "true" && text !== "false") continue;
      const [col, key] = f.field.split(".") as [FormColumn, string];
      if (meta.number && !NUM.test(text.replace(/[,\s$HK]/gi, ""))) continue;
      const cur = byColumn.get(col) ?? decryptColumn(id, col, row[col] as Record<string, string>);
      const old = cur[key] ?? "";
      const value = meta.checkbox ? (text === "true" ? "true" : "") : meta.number ? text.replace(/[,\s$HK]/gi, "") : text;
      cur[key] = meta.append && old.trim() ? `${old.trim()}\n\n${stamp(e.date)}\n${value}` : meta.append ? `${stamp(e.date)}\n${value}` : value;
      byColumn.set(col, cur);
    }
    for (const [col, values] of byColumn) patch[col] = encryptColumn(id, col, row[col] as Record<string, string>, values);

    for (const c of e.checks) patch[c] = true;
    Object.assign(patch,pipelinePatch({stage:e.stage || undefined,season:e.season || undefined},String(row.stage || "RR")));

    if(!alreadyRecorded){
    if((e.meeting?.occurred || hasClientFacts(e) && e.tasks?.length) && draftId && Object.keys(row).length){
      const {data,error}=await admin.from("clients").update(patch).eq("id",id).eq("owner_id",ownerId).eq("updated_at",row.updated_at).select("id");
      if(error||data?.length!==1)throw Error("客戶資料已更新，未有覆蓋新內容；請重新載入後再確認。");
      const {error:auditError}=await admin.from("audit_log").insert({actor_id:ownerId,client_owner_id:ownerId,record_id:id,table_name:"clients",action:e.meeting?.occurred?"MEETING_CONFIRMED":"CLIENT_UPDATE_CONFIRMED",changes:{draft_id:draftId,contact_record:true},via:d.channel||"whatsapp"});
      if(auditError)console.error("Meeting audit unavailable");
    }else{
      const {error}=await admin.rpc("wa_save_client",{p_actor:ownerId,p_id:id,p_patch:patch,p_create:d.target.mode==="new"&&!Object.keys(row).length});
      if(error)throw new Error("寫入客戶失敗："+error.message);
    }
    }
  }

  if((e.meeting?.occurred || hasClientFacts(e)) && e.tasks?.length){
    if(!draftId || !d.taskItems?.length)throw Error("見客紀錄已保存，但下一步未完成；請重試同一份確認。");
    const {error}=await admin.rpc("wa_save_tasks",{p_actor:ownerId,p_draft:draftId,p_items:d.taskItems});
    if(error)throw Error("見客紀錄已保存，但待辦未能儲存；可以重試確認，唔會重複新增見客紀錄。");
  }
  const hasAppt = e.appointment.slot !== "" && e.appointment.text.trim() !== "";
  if (hasAppt) {
    const { data, error: loadError } = await admin.from("activity_days").select("appts").eq("owner_id", ownerId).eq("day", e.date).maybeSingle();
    if (loadError) throw new Error("讀取日曆失敗：" + loadError.message);
    const rid = apptRecordId(ownerId, e.date);
    const cur = decryptColumn(rid, "appts", data?.appts);
    const old = cur[e.appointment.slot] ?? "";
    const add = e.appointment.text.trim().slice(0, 300);
    const appts = encryptColumn(rid, "appts", data?.appts ?? {}, {
      [e.appointment.slot]: old && !old.includes(add) ? `${old}；${add}`.slice(0, 300) : add,
    });
    const counts = {}; // 舊 RPC 保留相容，但不再增加任何活動次數。
    const { error } = await admin.rpc("wa_add_activity", { p_actor: ownerId, p_day: e.date, p_counts: counts, p_appts: appts });
    if (error) throw new Error("寫入日曆失敗：" + error.message);
  }
}


export function describeSavedDraft(d:Draft):string {
 return describeDraft(d)
   .replace("改期預覽（未儲存）：","已同步改期：")
   .replace(/幫你整理咗（未儲存）：/g,"已整理並同步到 app：")
   .replace("確認後會取消舊安排，加入新安排，並保留原記錄。","已取消舊安排、加入新安排，原記錄保留。")
   .replace(/回覆「確認」儲存，「取消」放棄；想補充就直接再講。/g,"").trim();
}
