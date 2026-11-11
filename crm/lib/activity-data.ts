import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPT_SLOTS } from "./activity";
import { calendarEntries } from "./followups";
import { decryptColumn } from "./secure";
import { addDays, weekDays } from "./weeks";

export type DayEntry = { day: string; appts: Record<string, string> };

type Row = { owner_id: string; day: string; appts?: Record<string, string> };

export const apptRecordId = (ownerId: string, day: string) => `${ownerId}:${day}`;

/** 某人某週 7 日嘅記錄（保留既有加密 appointment） */
export async function loadWeek(supabase: SupabaseClient, ownerId: string, monday: string): Promise<DayEntry[]> {
  const { data, error } = await supabase
    .from("activity_days")
    .select("owner_id, day, appts")
    .eq("owner_id", ownerId)
    .gte("day", monday)
    .lte("day", addDays(monday, 6));
  if (error) throw new Error(error.message);
  const byDay = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.day, r]));
  return weekDays(monday).map((day) => {
    const r = byDay.get(day);
    return {
      day,
      appts: r ? decryptColumn(apptRecordId(ownerId, day), "appts", r.appts) : {},
    };
  });
}

/** 所有已連結 appointment 供客戶頁、首頁共用；每項只儲存一次。 */
export async function loadCalendarEntries(supabase: SupabaseClient, ownerId: string, from?: string) {
  const days: DayEntry[] = [];
  for (let offset = 0; ; offset += 500) {
    let q = supabase.from("activity_days").select("owner_id, day, appts").eq("owner_id", ownerId).order("day").range(offset, offset + 499);
    if (from) q = q.gte("day", from);
    const { data, error } = await q;
    if (error) throw new Error("未能讀取日曆安排，請稍後重試。");
    for (const r of (data ?? []) as Row[]) days.push({ day:r.day, appts:decryptColumn(apptRecordId(ownerId,r.day),"appts",r.appts) });
    if (!data || data.length < 500) return calendarEntries(days, APPT_SLOTS);
  }
}

export async function loadTeamCalendarEntries(db:SupabaseClient,from:string){
 const entries:(ReturnType<typeof calendarEntries>[number]&{owner_id:string})[]=[];
 for(let offset=0;;offset+=500){const {data,error}=await db.from("activity_days").select("owner_id,day,appts").gte("day",from).order("day").order("owner_id").range(offset,offset+499);if(error)throw Error("未能讀取團隊日曆");for(const row of (data||[]) as Row[]){const appts=decryptColumn(apptRecordId(row.owner_id,row.day),"appts",row.appts);entries.push(...calendarEntries([{day:row.day,appts}],APPT_SLOTS).map(entry=>({...entry,owner_id:row.owner_id})));}if(!data||data.length<500)return entries;}
}
