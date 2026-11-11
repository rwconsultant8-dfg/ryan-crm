import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptColumn } from "./secure";
import { NO_SEASON, type SeasonColumn } from "./seasons";
import { CHECK_KEYS, CLIENT_FORMS, REFERRAL_STAGE_KEY, toPipelineStage, type Checks, type ClientFormColumn, type PipelineStage, type Stage } from "./stages";

export type ClientInfo = { name: string; age: string; gender: string; occupation: string; marital: string };

export type ClientCard = {
  id: string;
  owner_id: string;
  stage: PipelineStage;
  season: SeasonColumn;
  ready_to_sign: boolean;
  checks: Checks;
  info: ClientInfo;
  updated_at: string;
};

export type ClientFull = ClientCard & {
  forms: Record<ClientFormColumn, Record<string, string>>;
  created_at: string;
};

const REFERRAL_STAGE_COL = `${REFERRAL_STAGE_KEY}:form_pc->>${REFERRAL_STAGE_KEY}`;
const CARD_COLS = [REFERRAL_STAGE_COL, "id", "owner_id", "stage", "season", "ready_to_sign", "info", "updated_at", ...CHECK_KEYS].join(", ");

type Row = Record<string, unknown> & { id: string };

function toInfo(id: string, enc: unknown): ClientInfo {
  const p = decryptColumn(id, "info", enc as Record<string, string>);
  return {
    name: p.name ?? "",
    age: p.age ?? "",
    gender: p.gender ?? "",
    occupation: p.occupation ?? "",
    marital: p.marital ?? "",
  };
}

function toCard(r: Row): ClientCard {
  const checks = Object.fromEntries(CHECK_KEYS.map((k) => [k, Boolean(r[k])])) as Checks;
  const storedStage = r.stage as Stage;
  const marker = r[REFERRAL_STAGE_KEY];
  const referral = storedStage === "SIGNED" && typeof marker === "string"
    && decryptColumn(r.id, "form_pc", { [REFERRAL_STAGE_KEY]: marker })[REFERRAL_STAGE_KEY] === "true";
  return {
    id: r.id,
    owner_id: r.owner_id as string,
    stage: toPipelineStage(storedStage, referral),
    season: ((r.season as string | null) ?? NO_SEASON) as SeasonColumn,
    ready_to_sign: Boolean(r.ready_to_sign),
    checks,
    info: toInfo(r.id, r.info),
    updated_at: r.updated_at as string,
  };
}

/** RLS 決定睇到邊啲：員工淨係自己；管理員全部（可用 ownerId 篩選） */
export async function listClientCards(supabase: SupabaseClient, ownerId?: string): Promise<ClientCard[]> {
  let q = supabase.from("clients").select(CARD_COLS).order("updated_at", { ascending: false });
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(toCard);
}

export async function getClientFull(supabase: SupabaseClient, id: string): Promise<ClientFull | null> {
  const { data, error } = await supabase.from("clients").select(`*, ${REFERRAL_STAGE_COL}`).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const r = data as Row;
  const forms = Object.fromEntries(
    CLIENT_FORMS.map((f) => [f.column, decryptColumn(r.id, f.column, r[f.column] as Record<string, string>)]),
  ) as Record<ClientFormColumn, Record<string, string>>;
  return { ...toCard(r), forms, created_at: r.created_at as string };
}

export function toBoardCards(cards: ClientCard[]) {
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
  }));
}
