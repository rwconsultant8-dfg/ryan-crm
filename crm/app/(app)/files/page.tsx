import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileScope, listBotFiles } from "@/lib/telegram/files";

export default async function FilesPage(){
  const {profile}=await requireUser();
  try {
    const files=await listBotFiles(createAdminClient(),fileScope("coach",profile.id));
    return <><h1>我的 File</h1><p className="muted">你自己嘅文字更新、相片同文件。</p><Link className="btn" href="/board">返回客戶 ↗</Link><section className="card" style={{marginTop:20}}><h2>最近 50 份檔案</h2>{files.length ? <ul>{files.map(f=><li key={f.key} style={{marginBottom:16}}><a href={`/files/${encodeURIComponent(f.key)}`}>{f.name} ↓</a>{f.created_at && <span className="small muted"> · {new Date(f.created_at).toLocaleString("zh-HK",{timeZone:"Asia/Hong_Kong",hour12:false})}</span>}</li>)}</ul> : <p className="muted">暫時未有檔案。連線完成後，可以直接私訊 Ryan大佬bot 上傳。</p>}</section></>;
  } catch{return <><h1>我的 File</h1><p className="notice" role="status">私人檔案區暫時未能讀取。Telegram 連線完成後，再傳送文件或重新載入。</p></>;}
}
