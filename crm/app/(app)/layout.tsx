import Link from "next/link";
import { requireUser, displayName } from "@/lib/auth";
import { signOut } from "../login/actions";
import {getProfileAvatar} from "@/lib/profile-avatar";
import ProfileAvatar from "@/components/ProfileAvatar";
import NavLinks from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const avatar=await getProfileAvatar(profile).catch(()=>null);
  const isAdmin = profile.role === "admin";
  return (
    <div className={`journal-shell ${isAdmin ? "manager-layout" : "staff-layout"}`} data-persona={avatar?.key||"default"}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand"><span className="brand-symbol" aria-hidden="true">R</span><span>RYAN <small>{isAdmin ? "TEAM JOURNAL" : "MY JOURNAL"}</small></span></span>
          <NavLinks isAdmin={isAdmin} />
          <div className="who">
            <Link href="/account" className="account-identity">
              {avatar&&<ProfileAvatar avatar={avatar}/>}
              {displayName(profile)}
              {isAdmin && "（主管）"}
            </Link>
            <form action={signOut}>
              <button className="btn btn-sm">登出</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
