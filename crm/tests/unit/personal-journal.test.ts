import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),view:vi.fn(),avatar:vi.fn(),tasks:vi.fn()}));
vi.mock("next/link",()=>({default:({href,children,...props}:any)=>React.createElement("a",{href,...props},children)}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
vi.mock("@/lib/auth",()=>({requireUser:mocks.auth,displayName:(p:any)=>p.full_name||p.email}));
vi.mock("@/lib/viewing",()=>({resolveViewedOwner:mocks.view}));
vi.mock("@/lib/profile-avatar",()=>({getProfileAvatar:mocks.avatar}));
vi.mock("@/lib/planner-data",()=>({loadFollowups:async()=>[],loadTasks:mocks.tasks}));
vi.mock("@/lib/activity-data",()=>({loadCalendarEntries:async()=>[]}));
vi.mock("@/lib/data",()=>({listClientCards:async()=>[]}));
vi.mock("@/lib/coaching/store",()=>({loadCoaching:async()=>[]}));
import PersonalCover from "@/components/PersonalCover";
import DailyPlanner from "@/components/DailyPlanner";
import TodayPage from "@/app/(app)/today/page";
const people=[{key:"ryan",label:"Ryan"},{key:"chelsea",label:"Chelsea"},{key:"kiky",label:"Kiky"},{key:"momo",label:"Momo"}] as const;
beforeEach(()=>{vi.stubGlobal("React",React);vi.clearAllMocks();mocks.auth.mockResolvedValue({supabase:{},profile:{id:"momo",full_name:"Momo",role:"agent",active:true}});mocks.view.mockResolvedValue({owner:{id:"momo",full_name:"Momo"},readOnly:false});mocks.avatar.mockResolvedValue(people[3]);});
afterEach(()=>vi.unstubAllGlobals());
describe("personal journal covers",()=>{
 it("keeps every portrait behind the authenticated image route and names it accessibly",()=>{for(const person of people){const html=renderToStaticMarkup(React.createElement(PersonalCover,{name:person.label,avatar:person,today:"2026-11-06"}));expect(html).toContain('src="/api/account/avatar?portrait=');expect(html).toContain(`${person.label} 嘅個人封面相片`);expect(html).toContain("06 NOV 2026");expect(html).not.toContain("base64");expect(html).not.toContain("約會");}});
 it("connects the staff cover to the plan form and manager cover to the real team section",()=>{const staff=renderToStaticMarkup(React.createElement(PersonalCover,{name:"Chelsea",avatar:people[1],today:"2026-11-06"}));const admin=renderToStaticMarkup(React.createElement(PersonalCover,{name:"Ryan",avatar:people[0],today:"2026-11-06",manager:true}));expect(staff).toContain('href="#new-plan"');expect(admin).toContain('href="#team-focus"');expect(admin).toContain('href="/today"');});
 it("shows a signed-in person's initial when no photo is available",()=>{const html=renderToStaticMarkup(React.createElement(PersonalCover,{name:"Jean",avatar:null,today:"2026-11-06"}));expect(html).toContain("Jean");expect(html).toContain("personal-monogram");expect(html).not.toContain("<img");});
 it("does not misrepresent a colleague's read-only task view with the supervisor's cover",async()=>{mocks.view.mockResolvedValue({owner:{id:"chelsea",full_name:"Chelsea"},readOnly:true});const html=renderToStaticMarkup(await TodayPage({searchParams:Promise.resolve({agent:"chelsea"})}));expect(mocks.avatar).not.toHaveBeenCalled();expect(html).not.toContain('aria-label="Momo 嘅個人日誌"');expect(html).toContain("Chelsea 嘅安排");expect(html).toContain("主管唯讀");});
 it("lets a supervisor see every colleague's tasks for the selected date, read only", async () => {
  const day = "2026-11-09";
  const teammate = (id: string, full_name: string, active = true) => ({ id, full_name, email: "", active });
  const records = [teammate("ryan", "Ryan"), teammate("chelsea", "Chelsea"), teammate("kiky", "Kiky"), teammate("momo", "Momo", false)];
  const task = (owner_id: string, plan: string, status = "planned", date = day) => ({
    id: plan, owner_id, day: date, name: "跟進客戶", category: "planning", plan, status,
  });
  mocks.auth.mockResolvedValue({
    profile: { ...records[0], role: "admin" },
    supabase: { from: () => ({ select: () => ({ order: async () => ({ data: records, error: null }) }) }) },
  });
  mocks.tasks.mockResolvedValue([
    task("chelsea", "準備計劃書"),
    { ...task("kiky", "核對文件", "done"), time: "14:30", result: "已收齊文件" },
    task("momo", "已取消舊安排", "cancelled"),
    task("ryan", "主管自己嘅任務"),
    task("chelsea", "另一日任務", "planned", "2026-11-10"),
  ]);
  const html = renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve({ view: "team", day }) }));
  expect(mocks.tasks).toHaveBeenCalledWith(expect.anything(), day, day);
  expect(mocks.view).not.toHaveBeenCalled();
  for (const text of ["團隊每日任務", "主管唯讀", "Chelsea", "Kiky", "Momo（已停用）", "準備計劃書", "核對文件", "14:30", "已完成", "已收齊文件", "已取消舊安排"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('href="/today?agent=chelsea&amp;day=2026-11-09"');
  expect(html).toContain('href="/today?view=team&amp;day=2026-11-10"');
  for (const text of ["主管自己嘅任務", "另一日任務", "儲存結果", "加入任務"]) expect(html).not.toContain(text);
 });
 it("keeps a staff member in the personal planner even if they request the team view", async () => {
  const html = renderToStaticMarkup(await TodayPage({
    searchParams: Promise.resolve({ view: "team", day: "2026-11-09", agent: "chelsea" }),
  }));
  expect(mocks.tasks).not.toHaveBeenCalled();
  expect(html).not.toContain("團隊每日任務");
  expect(html).toContain('id="new-plan"');
 });
 it("keeps tasks usable while removing the duplicate quest introduction",()=>{const html=renderToStaticMarkup(React.createElement(DailyPlanner,{tasks:[],focusTasks:[],monday:"2026-11-02",today:"2026-11-06",readOnly:false,showIntro:false}));expect(html).not.toContain("quest-hero");expect(html).not.toContain("本週里程碑");expect(html).toContain('id="new-plan"');expect(html).toContain("每日任務");});
 it("writes a self-contained four-person design preview with labelled demonstration content",()=>{
  const css=readFileSync(resolve("app/globals.css"),"utf8");
  const panels=people.map(person=>{const encoded=readFileSync(resolve(`lib/profile/${person.key}-photo.ts`),"utf8").match(/BASE64="([^"]+)"/)![1];let cover=renderToStaticMarkup(React.createElement(PersonalCover,{name:person.label,avatar:person,today:"2026-11-06",manager:person.key==="ryan"}));cover=cover.replace(/\/api\/account\/avatar(?:\?[^"]*)?/g,`data:image/jpeg;base64,${encoded}`).replace(/<link[^>]*as="image"[^>]*>/g,"");return `<div class="journal-shell" data-persona="${person.key}" id="preview-${person.key}" ${person.key!=="ryan"?'hidden':''}><main class="page">${cover}<section class="card" id="${person.key==="ryan"?'team-focus':'new-plan'}"><h2>${person.key==="ryan"?'團隊跟進':'今日安排'} · 版面示範</h2><p>呢份預覽只示範設計；正式 app 會顯示自己嘅實際安排。</p></section></main></div>`;}).join("");
  const dir=resolve("../preview");mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,"personal-journal.html"),`<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>個人日誌封面預覽</title><style>${css}\n[hidden]{display:none!important}.preview-switcher{padding:16px;display:flex;gap:8px;flex-wrap:wrap;background:#111819;color:#fff}.preview-switcher button{font:inherit;padding:10px 16px;background:#dce8e5;color:#111819;border:0;border-radius:8px;cursor:pointer}</style></head><body><nav class="preview-switcher" aria-label="預覽人物">${people.map(p=>`<button type="button" data-person="${p.key}" aria-pressed="${p.key==='ryan'}">${p.label}</button>`).join('')}<span>設計預覽</span></nav>${panels}<script>document.querySelectorAll('[data-person]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.journal-shell').forEach(panel=>panel.hidden=panel.id!=='preview-'+button.dataset.person);document.querySelectorAll('[data-person]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));}));</script></body></html>`);
  expect(panels).not.toContain('src="/api/account/avatar?portrait=');
 });
});
