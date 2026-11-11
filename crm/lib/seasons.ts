import { normalizeStage, storageStage, isStage, type Stage } from "./stages";
// 人脈網沿用資料庫 enum，舊資料毋須遷移或刪除。
export type Season = "SPRING" | "AUTUMN" | "SUMMER";
export const NO_SEASON = "NONE";
export type SeasonColumn = Season | typeof NO_SEASON;
export type SeasonDef = {
  key: Season;
  label: string;
  emoji: string;
  state: string;
  focus: string;
  actions: string[];
};
export const SEASONS: SeasonDef[] = [
  { key: "SPRING", label: "Fact Finding", emoji: "📋", state: "了解客戶", focus: "整理基本資料及客戶現況",
    actions: ["了解客戶基本資料", "記錄家庭、工作同財務現況", "按已填資料核對 checklist"] },
  { key: "AUTUMN", label: "Needs", emoji: "☑️", state: "釐清需要", focus: "保障和財富增值",
    actions: ["了解客戶已表達嘅需要", "勾選相關產品類別", "記錄需要同下一步"] },
  { key: "SUMMER", label: "Presentation", emoji: "🤝", state: "建立共識", focus: "令計劃書與客戶產生關聯",
    actions: ["對應客戶需要同計劃內容", "記錄已達成嘅共識", "進行 Drill 講解練習"] },
];
export const isSeason = (v: unknown): v is Season => SEASONS.some((s) => s.key === v);
/** 舊冬季、未分類及新客戶先放相約見面；每張卡都有可見欄位。 */
export const normalizeSeason = (v: unknown): Season => isSeason(v) ? v : "SPRING";
export const seasonLabel = (s: string | null | undefined) => {
  const d = SEASONS.find((x) => x.key === normalizeSeason(s))!;
  return `${d.emoji} ${d.label}`;
};
export const SIGNED_ZONE = "SIGNED_ZONE";

/** 人脈網與客戶進度共用同一跟進階段；原有細表格階段仍保留。 */
export const seasonForStage = (stage: string): Season => normalizeStage(stage) === "FOLLOWUP" ? "AUTUMN" : ["PROPOSAL","SIGNED","ISSUED"].includes(normalizeStage(stage)) ? "SUMMER" : "SPRING";
export const stageForSeason = (season: string | null): Stage => season === "AUTUMN" ? "FOLLOWUP" : season === "SUMMER" ? "PROPOSAL" : "MEETING";

/** 所有寫入入口共用規則，防止同一客戶喺兩個看板出現互相矛盾嘅進度。 */
export function pipelinePatch(change: {stage?: string; season?: string | null}, currentStage = "RR"): Record<string,string> {
  const out:Record<string,string> = {};
  if (change.stage && !isStage(change.stage) && !["RR","NR1","NR2","FNA","PC"].includes(change.stage)) throw new Error("客戶進度無效");
  if (change.stage) { out.stage=storageStage(normalizeStage(change.stage)); out.season=seasonForStage(change.stage); }
  if (change.season !== undefined) {
    const phase=normalizeSeason(change.season), effective=change.stage || currentStage;
    if (change.stage && seasonForStage(change.stage)!==phase) throw new Error("客戶階段同人脈分類不一致，請確認後再儲存。");
    if ((effective==="SIGNED" || effective==="ISSUED") && phase!=="SUMMER") throw new Error("客戶已簽單／已出單；請先明確撤回已簽狀態。");
    out.season=phase;
    if (!change.stage && effective!=="SIGNED" && effective!=="ISSUED") out.stage=storageStage(stageForSeason(phase));
  }
  return out;
}
