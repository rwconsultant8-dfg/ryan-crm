import Link from "next/link";
import { requireUser, displayName } from "@/lib/auth";
import {getProfileAvatar} from "@/lib/profile-avatar";
import PersonalCover from "@/components/PersonalCover";
import {hkToday} from "@/lib/weeks";
import PasswordForm from "./PasswordForm";

export default async function AccountPage() {
  const { profile } = await requireUser();
  const avatar=await getProfileAvatar(profile).catch(()=>null);
  return (
    <div className="personal-account-page">
      <PersonalCover name={displayName(profile)} avatar={avatar} today={hkToday()} manager={profile.role==="admin"} account/>
      <div className="narrow">
      <h2>我的帳戶</h2>
      <div className="card account-profile" style={{ marginBottom: 16 }}>
        <div>
        <div>{displayName(profile)}</div>
        <div className="muted small">{profile.email} · {profile.role === "admin" ? "主管" : "員工"}</div>
        </div>
      </div>
      {profile.role !== "admin" && <div className="row" style={{marginBottom:20}}><Link className="btn" href="/business">我的生意表</Link></div>}
      <PasswordForm />
      </div>
    </div>
  );
}
