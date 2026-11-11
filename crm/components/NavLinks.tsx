"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const links = isAdmin ? [
    { href: "/admin", label: "Ryan大佬bot總覽", mark: "⌘" },
    { href: "/today", label: "每日任務", mark: "◈" },
    { href: "/board", label: "客戶", mark: "▥" },
    { href: "/activity", label: "日曆", mark: "▦" },
    { href: "/business", label: "生意表", mark: "↗" },
    { href: "/updates", label: "同事更新", mark: "▤" },
    { href: "/admin/staff", label: "員工帳戶", mark: "♙" },
    { href: "/account", label: "我的帳戶", mark: "○" },
  ] : [
    { href: "/today", label: "今日", mark: "◈" },
    { href: "/board", label: "客戶", mark: "▥" },
    { href: "/activity", label: "日曆", mark: "▦" },
    { href: "/business", label: "生意表", mark: "↗" },
    { href: "/files", label: "我的 File", mark: "▤" },
  ];
  const primary=new Set(["/admin","/today","/board","/activity"]);
  const link=(l:typeof links[number],extra=false)=>{
    const active=l.href==="/admin"?path==="/admin"||path.startsWith("/admin/agents"):path===l.href||path.startsWith(l.href+"/");
    return <Link key={l.href} href={l.href} className={[active?"active":"",extra?"manager-extra-link":""].filter(Boolean).join(" ")||undefined} aria-current={active?"page":undefined}><span aria-hidden="true">{l.mark}</span>{l.label}</Link>;
  };
  return <nav className="nav" aria-label="主要導覽">{links.map(l=>link(l,isAdmin&&!primary.has(l.href)))}{isAdmin&&<details className="mobile-manager-menu"><summary>更多功能</summary><div>{links.filter(l=>!primary.has(l.href)).map(l=>link(l))}</div></details>}</nav>;
}
