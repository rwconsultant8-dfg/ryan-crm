import type {Task} from "./planner";
/** Client service meetings are appointments too; a work category must not hide them. */
export function isCalendarTask(t:Pick<Task,"category"|"status"|"time"|"period"|"client_id">){
 return t.status!=="cancelled" && (t.category==="appointment" || t.category==="service" && Boolean((t.time || t.period) && t.client_id));
}
