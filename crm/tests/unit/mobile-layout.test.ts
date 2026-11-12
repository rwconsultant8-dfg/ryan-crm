import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import postcss from "postcss";
vi.mock("next/link",()=>({default:({href,children,...props}:{href:string;children:React.ReactNode})=>React.createElement("a",{href,...props},children)}));
vi.mock("next/navigation",()=>({usePathname:()=>"/board",useRouter:()=>({refresh:vi.fn(),push:vi.fn()}),redirect:vi.fn()}));
import NavLinks from "@/components/NavLinks";
import Board from "@/components/Board";
import InfoFields from "@/components/InfoFields";
import {CHECK_KEYS} from "@/lib/stages";
const css=readFileSync(resolve("app/globals.css"),"utf8");
beforeEach(()=>vi.stubGlobal("React",React));afterEach(()=>vi.unstubAllGlobals());
function luminance(hex:string){const rgb=hex.replace("#","").match(/../g)!.map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(values[0]+.05)/(values[1]+.05);}
describe("readable phone and desktop layouts",()=>{
 it("parses the stylesheet and keeps text/background pairs above AA contrast",()=>{
  const root=postcss.parse(css),colors:Record<string,string>={};root.walkRules(rule=>{if(rule.selector===":root")rule.walkDecls(decl=>{colors[decl.prop]=decl.value;});});
  for(const [fg,bg] of [["--text","--surface"],["--muted","--surface"],["--primary-text","--primary"],["--yellow","--yellow-bg"],["--green","--green-bg"],["--red","--red-bg"]])expect(contrast(colors[fg],colors[bg]),`${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
 });
 it("keeps every supervisor destination accessible with secondary links in a collapsible phone menu",()=>{const html=renderToStaticMarkup(React.createElement(NavLinks,{isAdmin:true}));expect(html).toContain('class="mobile-manager-menu"');expect(html).toContain("更多功能");for(const href of ["/admin","/today","/board","/activity","/admin/staff","/updates"])expect(html).toContain(`href="${href}"`);expect(html).not.toMatch(/<details[^>]*open/);});
 it("retains approximate age in a text input so phone keyboards do not force a made-up number",()=>{const html=renderToStaticMarkup(React.createElement(InfoFields,{value:{name:"測試客戶",age:"50幾",gender:"",occupation:"",marital:""},onChange:()=>{}}));expect(html).toMatch(/<input type="text"[^>]*name="age"/);expect(html).toContain('value="50幾"');expect(html).not.toContain('type="number"');});
 it("offers all five customer stages and selects a populated one on a narrow screen without deleting desktop columns",()=>{
  const cards=[{id:"sample",name:"測試客戶",age:"50幾",gender:"",occupation:"會計",stage:"FOLLOWUP" as const,season:"SUMMER" as const,ready:false,checks:Object.fromEntries(CHECK_KEYS.map(k=>[k,false])) as never}];
  const html=renderToStaticMarkup(React.createElement(Board,{cards,readOnly:true}));
  expect(html).toContain('aria-label="選擇客戶分類"');expect(html).toMatch(/<option value="FOLLOWUP" selected=""/);expect(html).toContain("Needs · 1 位");expect(html.match(/data-stage=/g)).toHaveLength(5);expect(html.match(/mobile-selected/g)).toHaveLength(1);
  const dir=resolve("../preview");mkdirSync(dir,{recursive:true});const nav=renderToStaticMarkup(React.createElement(NavLinks,{isAdmin:true}));
  writeFileSync(resolve(dir,"responsive-customer.html"),`<!doctype html><html lang="zh-HK"><meta name="viewport" content="width=device-width,initial-scale=1"><title>電話／桌面版預覽（示範資料）</title><style>${css}</style><body><div class="manager-layout"><header class="topbar"><div class="topbar-inner"><span class="brand">RYAN CRM</span>${nav}</div></header><main class="page"><h1>我的客戶 · 示範資料</h1><p class="muted">電話以分類選單顯示，桌面保留完整五欄。</p>${html}<section class="card" style="margin-top:20px"><h2>基本資料</h2>${renderToStaticMarkup(React.createElement(InfoFields,{value:{name:"測試客戶",age:"50幾",gender:"",occupation:"會計",marital:""},onChange:()=>{}}))}</section></main></div></body></html>`);
 });
});
