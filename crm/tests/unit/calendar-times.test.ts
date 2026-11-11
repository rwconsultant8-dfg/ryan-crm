import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {appointmentSlot} from "@/lib/activity";
import type {Task} from "@/lib/planner";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/app/(app)/activity/actions",()=>({saveActivityWeekAction:vi.fn()}));
import ActivityWeek from "@/components/ActivityWeek";
beforeEach(()=>vi.stubGlobal("React",React));afterEach(()=>vi.unstubAllGlobals());
const task=(id:string,time:string,status:Task["status"]="planned"):Task=>({id,owner_id:"kiky",day:"2026-11-09",category:"appointment",stage:"",name:id,plan:`見客-${id}`,time,status,result:"",updated_at:""});
describe("appointment time → calendar slot",()=>{
 it("places 15:00 in tea and respects all four slot boundaries",()=>{
  for(const [time,slot] of [["08:00","breakfast"],["09:59","breakfast"],["12:00","lunch"],["13:59","lunch"],["15:00","tea"],["16:59","tea"],["19:00","dinner"],["20:59","dinner"],["10:00","breakfast"],["14:00","lunch"],["17:00","tea"],["21:00","dinner"],["10:01",null],["14:01",null],["17:01",null],["21:01",null],["",null],["25:00",null]] as const)expect(appointmentSlot(time)).toBe(slot);
 });
 it("renders both 3pm and 4pm appointments inside tea, once each, and hides cancelled appointments",()=>{
  const html=renderToStaticMarkup(React.createElement(ActivityWeek,{days:[{day:"2026-11-09",appts:{}}],today:"2026-11-09",readOnly:true,tasks:[task("Mary","15:00"),task("Peter","16:00"),task("Cancelled","15:30","cancelled"),task("Unslotted","18:00"),{...task("Service","19:00"),category:"service",client_id:"client-service"}]}));
  const tea=html.slice(html.indexOf("<strong>下午茶</strong>"),html.indexOf("<strong>晚飯</strong>"));
  expect(tea).toContain("15:00");expect(tea).toContain("Mary");expect(tea).toContain("16:00");expect(tea).toContain("Peter");
  expect(html.match(/見客-Mary/g)).toHaveLength(1);expect(html).not.toContain("Cancelled");expect(html).toContain("18:00");expect(html.slice(html.indexOf("<strong>晚飯</strong>"))).toContain("見客-Service");
 });
});
