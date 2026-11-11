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
 it("covers the whole day and assigns each boundary to exactly one period",()=>{
  for(const [time,slot] of [["00:00","dinner"],["05:59","dinner"],["06:00","breakfast"],["11:59","breakfast"],["12:00","lunch"],["13:59","lunch"],["14:00","tea"],["17:59","tea"],["18:00","dinner"],["23:59","dinner"],["10:01","breakfast"],["14:01","tea"],["17:01","tea"],["21:01","dinner"],["",null],["25:00",null]] as const)expect(appointmentSlot(time)).toBe(slot);
  for(let minutes=0;minutes<24*60;minutes++)expect(appointmentSlot(`${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`)).not.toBeNull();
 });
 it("places period-only arrangements without inventing a clock time, and gives an exact time priority",()=>{
  for(const [period,slot] of [["morning","breakfast"],["noon","lunch"],["afternoon","tea"],["evening","dinner"]] as const)expect(appointmentSlot("",period)).toBe(slot);
  expect(appointmentSlot("09:30","afternoon")).toBe("breakfast");
  expect(appointmentSlot("","unknown")).toBeNull();
  const html=renderToStaticMarkup(React.createElement(ActivityWeek,{days:[{day:"2026-11-09",appts:{}}],today:"2026-11-09",readOnly:true,tasks:[{...task("Mary",""),period:"afternoon"},{...task("Peter",""),period:"afternoon"},task("Undecided","")]}));
  const afternoon=html.slice(html.indexOf("<strong>下午</strong>"),html.indexOf("<strong>晚上</strong>"));
  expect(afternoon).toContain("下午 · Mary");expect(afternoon).toContain("下午 · Peter");expect(afternoon).not.toContain("15:00");
  expect(html).toContain("時間待定 · Undecided");expect(html.match(/見客-Mary/g)).toHaveLength(1);
 });
 it("renders both 3pm and 4pm appointments inside tea, once each, and hides cancelled appointments",()=>{
  const html=renderToStaticMarkup(React.createElement(ActivityWeek,{days:[{day:"2026-11-09",appts:{}}],today:"2026-11-09",readOnly:true,tasks:[task("Mary","15:00"),task("Peter","16:00"),task("Cancelled","15:30","cancelled"),task("Unslotted","18:00"),{...task("Service","19:00"),category:"service",client_id:"client-service"}]}));
  const tea=html.slice(html.indexOf("<strong>下午</strong>"),html.indexOf("<strong>晚上</strong>"));
  expect(tea).toContain("15:00");expect(tea).toContain("Mary");expect(tea).toContain("16:00");expect(tea).toContain("Peter");
  expect(html.match(/見客-Mary/g)).toHaveLength(1);expect(html).not.toContain("Cancelled");expect(html).toContain("18:00");expect(html.slice(html.indexOf("<strong>晚上</strong>"))).toContain("見客-Service");
 });
});
