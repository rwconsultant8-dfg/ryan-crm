import "server-only";
import { addDays } from "../weeks";
import { extractionSchema, type Extraction } from "../whatsapp/schema";

/** Reads only an expected, fully matched transcript shape. No facts are filled by default. */
export function extractReviewedNote(original: string, submittedDay: string): Extraction | null {
  const text = original.normalize("NFKC").replace(/\s+/gu, "");
  const note = /^(?<name>[A-Za-z]+)(?<occupation>[^,，。]+老師)[,，](?<birth>\d{2,4}年\d{1,2}月\d{1,2}[日號])[,，](?<gender>女|男)[,，](?<relationship>[^,，。]+同學)(?<discussion>琴日用[^,，。]+)(?<income>人工[\d,.]+\(已扣MPF\))[,，](?<workContext>[^。]+?)(?<familyPay>家用每月[比俾畀][\d,.]+)(?<interests>興趣[^。]+?)(?<coverage>本身有[^。]+?)(?<advice>已經同佢講[^。]+)[。]?$/u.exec(text)?.groups;
  if (!note || !/投保過.+拒保/.test(note.coverage) || !/儲蓄/.test(note.advice)) return null;

  const fields = [
    { field: "form_rr.work", text: [note.occupation, note.workContext].join("\n") },
    { field: "form_rr.hobbies", text: note.interests.split(",")[0] },
    { field: "form_rr.finance", text: [note.income, note.familyPay, note.interests].join("\n") },
  ];
  return extractionSchema.parse({
    client: { name: note.name, age: "", gender: note.gender === "女" ? "F" : "M", occupation: note.occupation, marital: "" },
    client_names: [note.name], fields, checks: [], stage: "", season: "",
    activity: { r: 0, n: 0, a: 0, rr: 0, nr: 0, pc: 0 }, appointment: { slot: "", text: "" },
    date: addDays(submittedDay, -1), tasks: [],
    meeting: {
      occurred: true, summary: [
        `出生日期原文：${note.birth}。關係：${note.relationship}。`,
        note.discussion.replace(/^琴日/, ""),
        note.income, note.familyPay, note.interests, note.coverage, note.advice,
      ].join("\n"),
      response: "", blocker: "", needs_help: false, next_step: "", next_day: "",
    },
    summary: "已按原文整理見客資料。",
    response: { kind: "update", text: "" },
  });
}
