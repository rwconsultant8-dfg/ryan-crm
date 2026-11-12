import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {describe,it,expect,vi} from "vitest";
import MeetingBrief from "@/components/MeetingBrief";
import type { CoachingNote } from "@/lib/coaching/types";
import {coachRows,lastContactOf,linkKnownTasks,clientBrief} from "@/lib/coaching/summary";
const card=(id:string,owner:string,name="Mary")=>({id,owner_id:owner,stage:"MEETING",info:{name,age:"50幾",contact_history:""},forms:{},updated_at:"2026-11-06T00:00:00Z"}) as any;
const task=(owner:string,client_id="")=>({id:owner,owner_id:owner,name:"Mary",client_id,day:"2026-11-05",status:"planned",plan:"收集資料"}) as any;
describe("grounded coaching analysis",()=>{
 it("never treats general edits or notes as actual client contact",()=>{const c=card("c","a");c.info.contact_history=JSON.stringify([{id:"x",kind:"note",at:"2026-11-06T00:00:00Z",text:"主管更新"},{id:"y",kind:"contact",at:"2026-10-01T00:00:00Z",day:"2026-10-01",text:"已聯絡"}]);expect(lastContactOf(c,"2026-11-06")).toBe("2026-10-01");expect(lastContactOf(card("d","a"),"2026-11-06")).toBe("");});
 it("links legacy names only when unique within same owner",()=>{const cards=[card("a1","a"),card("a2","a"),card("b1","b")];const linked=linkKnownTasks(cards,[task("a"),task("b"),task("a","b1")]);expect(linked.map(t=>t.client_id)).toEqual(["","b1",""]);});
 it("does not borrow another colleague's follow-up or appointment",()=>{const c=card("c","a"),rows=coachRows([c],[task("b","c")],[{client_id:"c",owner_id:"b",day:"2026-11-07",text:"別人約會"}] as any,[],new Map(),"2026-11-06");expect(rows[0].missingNext).toBe(true);expect(rows[0].overdue).toBe(0);});
 it("shows an actual overdue linked task, not missing next step",()=>{const rows=coachRows([card("c","a")],[task("a","c")],[],[],new Map(),"2026-11-06");expect(rows[0].overdue).toBe(1);expect(rows[0].missingNext).toBe(false);});
 it("shows 未有部署 with no owner plan or supervisor guidance, even when the assistant extracted a next step", () => {
   const c = card("c", "a");
   c.info.contact_history = JSON.stringify([{
     id: "meeting", kind: "contact", day: "2026-11-06", at: "2026-11-06T00:00:00Z",
     text: "見客摘要", source: "telegram",
     meeting: { occurred: true, summary: "見客摘要", response: "", blocker: "", needs_help: false, next_step: "助手提議", next_day: "" },
   }]);
   const brief = clientBrief(c, [], "2026-11-06");
   expect(brief.known).toEqual([{ label: "年齡", text: "50幾歲" }]);
   vi.stubGlobal("React", React);
   try {
     const html = renderToStaticMarkup(React.createElement(MeetingBrief, {
       brief, clientId: c.id, clientName: c.info.name, ownerName: "同事", readOnly: true, coachingUnavailable: false,
     }));
     expect(html).toContain("未有部署");
     expect(html).not.toContain("助手提議");
     expect(html).not.toContain("今次最想解決邊個問題");
   } finally {
     vi.unstubAllGlobals();
   }
 });
 it("uses the client's manually saved next step and active supervisor guidance", () => {
   const c = card("c", "a");
   c.info.contact_history = JSON.stringify([{
     id: "meeting", kind: "contact", day: "2026-11-06", at: "2026-11-06T00:00:00Z",
     text: "見客摘要", source: "app",
     meeting: { occurred: true, summary: "見客摘要", response: "", blocker: "", needs_help: false, next_step: "帶舊保單", next_day: "2026-11-07" },
   }]);
   const guidance: CoachingNote = {
     id: "note", clientId: c.id, ownerId: c.owner_id, authorId: "admin", authorName: "Ryan", createdAt: "2026-11-06T00:00:00Z",
     request: "核對客戶帶嚟嘅文件", dueDay: "", status: "open", reply: "", revision: null,
   };
   const notes: CoachingNote[] = [
     { ...guidance, id: "other", ownerId: "other" },
     { ...guidance, id: "closed", status: "closed" },
     { ...guidance, id: "different-client", clientId: "elsewhere" },
     guidance,
   ];
   expect(clientBrief(c, notes, "2026-11-06")).toMatchObject({
     focus: "帶舊保單", focusDay: "2026-11-07", guidance: [guidance],
   });
   c.info.meeting_focus = JSON.stringify("確認上次留下嘅問題");
   expect(clientBrief(c, notes, "2026-11-06")).toMatchObject({
     focus: "確認上次留下嘅問題", focusDay: undefined, guidance: [guidance],
   });
   c.info.meeting_focus = JSON.stringify("");
   expect(clientBrief(c, [], "2026-11-06")).toMatchObject({ focus: "", guidance: [] });
 });
});
