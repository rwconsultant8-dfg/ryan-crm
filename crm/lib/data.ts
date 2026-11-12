import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn } from "./secure";
import { seasonForStage, type SeasonColumn } from "./seasons";
import { nextClientStep, type CalendarEntry } from "./followups";
import { hkToday } from "./weeks";
import type { Task } from "./planner";
import { CHECK_KEYS, FORMS, PROPOSAL_FIELD_ALIASES, REFERRAL_STAGE_KEY, normalizeStage, type Checks, type FormColumn, type Stage } from "./stages";

export type ClientInfo = { name: string; age: string; gender: string; occupation: string; marital: string; customer_type?: string; last_contact_at?: string; contact_history?:string; meeting_focus?:string };

export type ClientCard = {
  id: string;
  owner_id: string;
  stage: Stage;
  season: SeasonColumn;
  ready_to_sign: boolean;
  checks: Checks;
  info: ClientInfo;
  updated_at: string;
};

export type ClientFull = ClientCard & {
  forms: Record<FormColumn, Record<string, string>>;
  created_at: string;
};

const CARD_COLS = ["id", "owner_id", "stage", "season", "ready_to_sign", "info", "referral_stage:form_pc->>referral_stage", "updated_at", ...CHECK_KEYS].join(", ");

type Row = Record<string, unknown> & { id: string };

function toInfo(id: string, enc: unknown): ClientInfo {
  const p = decryptColumn(id, "info", enc as Record<string, string>);
  return {
    name: p.name ?? "",
    age: p.age ?? "",
    gender: p.gender ?? "",
    occupation: p.occupation ?? "",
    marital: p.marital ?? "",
    customer_type: p.customer_type ?? "",
    last_contact_at: p.last_contact_at || undefined,
    contact_history:p.contact_history || undefined,
    meeting_focus: p.meeting_focus,
  };
}

function toCard(r: Row, referred?: boolean): ClientCard {
  if (r.stage === "SIGNED" && referred === undefined && typeof r.referral_stage === "string") {
    referred = decryptColumn(r.id, "form_pc", { [REFERRAL_STAGE_KEY]: r.referral_stage })[REFERRAL_STAGE_KEY] === "true";
  }
  const stage = normalizeStage(r.stage, referred);
  const checks = Object.fromEntries(CHECK_KEYS.map((k) => [k, Boolean(r[k])])) as Checks;
  return {
    id: r.id,
    owner_id: r.owner_id as string,
    stage,
    season: seasonForStage(stage),
    ready_to_sign: Boolean(r.ready_to_sign),
    checks,
    info: toInfo(r.id, r.info),
    updated_at: r.updated_at as string,
  };
}

/** RLS 決定睇到邊啲：員工淨係自己；管理員全部（可用 ownerId 篩選） */
export async function listClientCards(supabase: SupabaseClient, ownerId?: string): Promise<ClientCard[]> {
  const cards:ClientCard[]=[];
  for(let offset=0;;offset+=500){
    let q=supabase.from("clients").select(CARD_COLS).order("updated_at",{ascending:false}).order("id").range(offset,offset+499);
    if(ownerId)q=q.eq("owner_id",ownerId);
    const {data,error}=await q;
    if(error)throw new Error(error.message);
    cards.push(...((data??[]) as unknown as Row[]).map((row) => toCard(row)));
    if(!data||data.length<500)return cards;
  }
}

export async function getClientFull(supabase: SupabaseClient, id: string): Promise<ClientFull | null> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const r = data as Row;
  const forms = Object.fromEntries(
    FORMS.map((f) => [f.column, decryptColumn(r.id, f.column, r[f.column] as Record<string, string>)]),
  ) as Record<FormColumn, Record<string, string>>;
  for (const [key, legacy] of Object.entries(PROPOSAL_FIELD_ALIASES)) {
    if (legacy && forms.form_pc[key] === undefined && !forms.form_pc[`cleared_${key}`] && forms.form_pc[legacy] !== undefined) {
      forms.form_pc[key] = forms.form_pc[legacy];
    }
  }
  return { ...toCard(r, forms.form_pc[REFERRAL_STAGE_KEY] === "true"), forms, created_at: r.created_at as string };
}

export function toBoardCards(cards: ClientCard[], tasks?: Task[], appointments?: CalendarEntry[]) {
  return cards.map((c) => ({
    id: c.id,
    stage: c.stage,
    season: c.season,
    ready: c.ready_to_sign,
    checks: c.checks,
    name: c.info.name,
    age: c.info.age,
    gender: c.info.gender,
    occupation: c.info.occupation,
    customerType: c.info.customer_type,
    lastContact: c.info.last_contact_at,
    next: tasks && appointments ? nextClientStep(tasks.filter(t=>t.owner_id===c.owner_id),appointments.filter(a=>!("owner_id" in a)||a.owner_id===c.owner_id),c.id,hkToday()) : undefined,
  }));
}
