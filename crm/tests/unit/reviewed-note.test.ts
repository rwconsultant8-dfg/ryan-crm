import {expect,it} from "vitest";
import {extractReviewedNote} from "@/lib/codex/reviewed-note";

it("maps the reviewed transcript without inventing an age, budget total or next appointment", () => {
  const note = "Ada 幼稚園老師，00年1月2號，女，大專同學\n琴日用表格計收入開支\n人工 21000（已扣 MPF），學校對比之前多啲\n家用每月比 6000\n興趣行山，裝備每件可能 1000\n本身有舊患，投保過醫療，拒保，已經同佢講儲蓄安排";
  const result = extractReviewedNote(note, "2026-11-12");
  expect(result?.client).toMatchObject({name:"Ada",occupation:"幼稚園老師",age:"",gender:"F"});
  expect(result?.date).toBe("2026-11-11");
  expect(result?.meeting?.summary).toContain("投保過醫療,拒保");
  expect(result?.fields.find((field)=>field.field==="form_rr.finance")?.text).toContain("家用每月比6000");
  expect(result?.tasks).toEqual([]);
  expect(extractReviewedNote("Ada，請幫我查醫療保費", "2026-11-12")).toBeNull();
});
