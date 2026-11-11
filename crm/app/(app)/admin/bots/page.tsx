import { requireAdmin } from "@/lib/auth";
import { paReady, paUserId } from "@/lib/telegram/config";
import { isCoachReady } from "@/lib/telegram/credentials";
import {codexMode} from "@/lib/codex/jobs";
import ConnectBots from "./ConnectBots";
export const maxDuration=60;
export default async function BotsPage(){
  await requireAdmin();
  const rows=[{name:"Ryan 私人 PA",ready:paReady(),access:"只限 Ryan 一對一私訊",data:"私人對話及 PA File，獨立保存"},{name:"Ryan大佬bot",ready:await isCoachReady(),access:"已綁定有效 CRM 帳戶嘅同事，各自私訊",data:"自己嘅 File、自己嘅客戶更新，確認後寫入 app"}];
  return <div className="narrow" style={{maxWidth:1000}}><h1>兩個 Telegram Bots</h1><p className="muted">兩個獨立 Bot、兩套金鑰。私人 PA 同同事更新入口分開。</p><div className="grid-2">{rows.map(row=><section className="card" key={row.name}><h2>{row.name}</h2><p>{row.access}</p><p>{row.data}</p><span className={`badge ${row.ready?"badge-green":"badge-yellow"}`}>{row.ready?"Bot 連線設定已齊":"Bot 連線設定未齊"}</span></section>)}</div><section className="card" style={{marginTop:20}}><h2>Ryan大佬bot 及 AI 連線設定</h2><p>如果 Bot 已經有回應，可以直接用下方「檢查 AI 是否可用」，毋須重新保存金鑰。首次連接時，由建立 Bot 嗰個 Telegram 帳戶打開 <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>，揀 /mybots → @Ryan_main_bot → API Token，複製金鑰，貼入下面一格。</p><p className="muted small">Bot 金鑰可直接喺呢頁加密保存，唔會顯示喺對話或回覆。客戶資料整理可以由 Codex 接手；私人 PA 可以稍後再設定。</p><p>連接後，同事私訊 Ryan大佬bot「/start」，將顯示嘅數字 ID 交主管喺「員工帳戶」綁定，就可以提交自己嘅客戶更新。</p><ConnectBots codex={codexMode()}/></section></div>;
}
