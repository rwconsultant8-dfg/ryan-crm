import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "../weeks";
import { decryptColumn } from "../secure";
import { APPT_SLOTS } from "../activity";
import { calendarEntries } from "../followups";
import { apptRecordId } from "../activity-data";

/** Only this employee's scheduling fields; no other staff or customer dossier. */
export async function loadSchedulingContext(db:SupabaseClient, owner:string, today:string) {
  const tasks:Record<string,unknown>[] = [], calendar:Record<string,unknown>[] = [];
  for (const table of ["daily_tasks","activity_days"] as const) {
    for (let offset=0;;offset+=200) {
      const columns=table==="daily_tasks"?"id,day,category,stage,status,info":"day,appts";
      const {data,error}=await db.from(table).select(columns).eq("owner_id",owner)
        .gte("day",addDays(today,-60)).lte("day",addDays(today,60))
        .order("day").order(table==="daily_tasks"?"id":"day").range(offset,offset+199);
      if(error)throw Error("未能讀取原有安排，請稍後再試；原有記錄未有改動。");
      for(const row of (data || []) as unknown as {id:string;day:string;category:string;stage:string;status:string;info:Record<string,string>;appts:Record<string,string>}[]) {
        if(table==="daily_tasks") {
          if(row.status!=="planned" && row.status!=="blocked")continue;
          const info=decryptColumn(row.id,"info",row.info);
          tasks.push({id:row.id,day:row.day,category:row.category,stage:row.stage,status:row.status,name:info.name,plan:info.plan,time:info.time || "",period:info.period || ""});
        } else {
          const appts=decryptColumn(apptRecordId(owner,row.day),"appts",row.appts);
          calendar.push(...calendarEntries([{day:row.day,appts}],APPT_SLOTS));
        }
      }
      if(!data || data.length<200)break;
    }
  }
  return {tasks,calendar};
}
