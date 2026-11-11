import type {Extraction} from "../whatsapp/schema";
import {addDays} from "../weeks";
import {normalizeAge} from "../age";
export const ROUTING_PROBE_ID="codex-meeting-coach-v3";
export const ROUTING_PROBE_TEXT="新增客戶「分類測試客戶」，50幾歲，兒子啱啱結婚，本人婚姻狀況未有講。做會計，月入港幣5萬，鍾意行山，希望60歲退休。今日已見面傾過，佢話想先睇清楚現有保單，卡住係未搵齊舊保單，需要 Ryan 幫手核對。下一步係聽日聯絡佢收集舊保單，請同時加入聽日嘅待辦（未完成）。請只整理已提供資料，唔好推論性格或保險需要。";
/** Synthetic regression check: this job can never enter the customer-write flow. */
export function routingProbePassed(e:Extraction,today?:string){
  const field=(key:string)=>e.fields.filter(f=>f.field===key).map(f=>f.text).join("\n");
  return e.client.name==="分類測試客戶" && normalizeAge(e.client.age)==="50幾" && e.client.marital==="" &&
    /會計/.test(e.client.occupation) && /兒子|個仔/.test(field("form_rr.family")) && /結婚/.test(field("form_rr.family")) &&
    /行山/.test(field("form_rr.hobbies")) && /60.*退休/.test(field("form_rr.personality")) &&
    !/50|五十|保守/.test(field("form_rr.personality")) &&
    field("form_fna.income").replace(/[,\s]/g,"")==="50000" && !/退休計劃|教育基金|保守/.test(field("form_rr.needs")) && !e.stage && !e.season && Boolean(e.meeting?.occurred && e.meeting.needs_help && e.meeting.summary && /保單/.test(e.meeting.response) && /保單/.test(e.meeting.blocker) && /保單/.test(e.meeting.next_step) && e.meeting.next_day && e.tasks?.some(t=>t.operation==="create" && t.name==="分類測試客戶" && t.status==="planned" && t.day===e.meeting!.next_day && /保單/.test(t.plan))) && (!today || e.date===today && e.meeting?.next_day===addDays(today,1));
}
