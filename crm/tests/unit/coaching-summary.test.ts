import {describe,it,expect} from "vitest";
import {coachRows,lastContactOf,linkKnownTasks,clientBrief} from "@/lib/coaching/summary";
const card=(id:string,owner:string,name="Mary")=>({id,owner_id:owner,stage:"MEETING",info:{name,age:"50幾",contact_history:""},forms:{},updated_at:"2026-11-06T00:00:00Z"}) as any;
const task=(owner:string,client_id="")=>({id:owner,owner_id:owner,name:"Mary",client_id,day:"2026-11-05",status:"planned",plan:"收集資料"}) as any;
describe("grounded coaching analysis",()=>{
 it("never treats general edits or notes as actual client contact",()=>{const c=card("c","a");c.info.contact_history=JSON.stringify([{id:"x",kind:"note",at:"2026-11-06T00:00:00Z",text:"主管更新"},{id:"y",kind:"contact",at:"2026-10-01T00:00:00Z",day:"2026-10-01",text:"已聯絡"}]);expect(lastContactOf(c,"2026-11-06")).toBe("2026-10-01");expect(lastContactOf(card("d","a"),"2026-11-06")).toBe("");});
 it("links legacy names only when unique within same owner",()=>{const cards=[card("a1","a"),card("a2","a"),card("b1","b")];const linked=linkKnownTasks(cards,[task("a"),task("b"),task("a","b1")]);expect(linked.map(t=>t.client_id)).toEqual(["","b1",""]);});
 it("does not borrow another colleague's follow-up or appointment",()=>{const c=card("c","a"),rows=coachRows([c],[task("b","c")],[{client_id:"c",owner_id:"b",day:"2026-11-07",text:"別人約會"}] as any,[],new Map(),"2026-11-06");expect(rows[0].missingNext).toBe(true);expect(rows[0].overdue).toBe(0);});
 it("shows an actual overdue linked task, not missing next step",()=>{const rows=coachRows([card("c","a")],[task("a","c")],[],[],new Map(),"2026-11-06");expect(rows[0].overdue).toBe(1);expect(rows[0].missingNext).toBe(false);});
 it("brief does not infer policies, personality or a name-only task association",()=>{const c=card("c","a"),brief=clientBrief(c,[task("a")],[],"2026-11-06");expect(brief.next).toBe(null);expect(brief.known).toEqual([{label:"年齡",text:"50幾歲"}]);expect(brief.questions.length).toBeGreaterThan(0);});
});
