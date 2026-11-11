import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("next/link",()=>({default:({href,children,...props}:{href:string;children:React.ReactNode})=>React.createElement("a",{href,...props},children)}));
vi.mock("next/navigation",()=>({usePathname:()=>"/today",useRouter:()=>({refresh:vi.fn(),push:vi.fn()}),redirect:(path:string)=>{throw new Error(`redirect:${path}`);}}));
import NavLinks from "@/components/NavLinks";
import DailyPlanner from "@/components/DailyPlanner";
import RemovedBotPage from "@/app/(app)/telegram/page";
import type {Task} from "@/lib/planner";
beforeEach(()=>vi.stubGlobal("React",React));afterEach(()=>vi.unstubAllGlobals());
describe("角色版面",()=>{
 it("gives colleagues five core links including their business table",()=>{const html=renderToStaticMarkup(React.createElement(NavLinks,{isAdmin:false}));expect([...html.matchAll(/<a /g)]).toHaveLength(5);for(const label of ["今日","客戶","日曆","生意表","我的 File"])expect(html).toContain(label);for(const text of ["Ryan大佬bot","/telegram","/updates","/admin","/seasons"])expect(html).not.toContain(text);});
 it("retains detailed supervisor navigation while removing the coach replay entry",()=>{const html=renderToStaticMarkup(React.createElement(NavLinks,{isAdmin:true}));for(const text of ["Ryan大佬bot總覽","同事更新","員工帳戶","生意表"])expect(html).toContain(text);for(const text of ["我的 File","審計記錄","Bot 設定",'href="/admin/bots"','href="/files"','href="/admin/audit"'])expect(html).not.toContain(text);expect(html).not.toContain("教練");expect(html).not.toContain('href="/telegram"');expect(html).not.toContain('href="/review"');expect(html).not.toContain('href="/seasons"');});
 it("shows the same task in a simple staff list and a detailed supervisor view",()=>{const task:Task={id:"task-1",owner_id:"staff",day:"2026-11-06",category:"appointment",stage:"needs",name:"測試客戶",plan:"跟進方案",status:"planned",result:"",updated_at:"2026-11-06T00:00:00Z"};const props={tasks:[task],focusTasks:[task],monday:"2026-11-02",today:"2026-11-06",readOnly:false};const staff=renderToStaticMarkup(React.createElement(DailyPlanner,{...props,simple:true}));const admin=renderToStaticMarkup(React.createElement(DailyPlanner,{...props,simple:false}));for(const html of [staff,admin]){expect(html).toContain("測試客戶");expect(html).toContain("跟進方案");}expect(staff).toContain("staff-task-list");for(const text of ["quest-hero","本週里程碑","planner-empty"])expect(staff).not.toContain(text);expect(admin).toContain("本週里程碑");});
 it("redirects old coach app bookmarks to the customer board",()=>{expect(()=>RemovedBotPage()).toThrow("redirect:/board");});
});
