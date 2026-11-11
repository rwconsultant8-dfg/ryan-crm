import Link from "next/link";
import type {ProfileAvatarInfo} from "@/lib/profile-avatar";
type Props={name:string;avatar:ProfileAvatarInfo|null;today:string;manager?:boolean;account?:boolean};
const months=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
/** A personal cover using only the signed-in person's authenticated portrait. */
export default function PersonalCover({name,avatar,today,manager=false,account=false}:Props){
 const [year,month,day]=today.split("-"),label=avatar?.label||name;
 return <section className={`personal-cover${account?" personal-cover-account":""}${avatar?"":" personal-cover-no-photo"}`} aria-label={`${label} 嘅個人日誌`}>
  <div className="personal-cover-copy">
   <div className="personal-edition"><span className="personal-edition-dot" aria-hidden="true"/>{account?"THE PERSONAL EDIT":manager?"THE TEAM EDIT":"THE DAILY EDIT"}<span className="personal-cover-date">{day} {months[Number(month)-1]} {year}</span></div>
   <p className="personal-greeting">{account?"呢度，係你嘅一頁。":"今日，由你話事。"}</p>
   <h1 className="personal-name">{label}<span className="personal-name-dot" aria-hidden="true">.</span></h1>
   <p className="personal-cover-intro">{account?"你嘅帳戶、你嘅日誌、你自己嘅節奏。":manager?"睇清團隊嘅每一步，喺最需要嘅地方幫一把。":"見客前準備，見客後記錄。將重要嘅下一步，留喺今日。"}</p>
   {!account&&<div className="personal-cover-actions"><Link className="btn btn-primary" href={manager?"#team-focus":"#new-plan"}>{manager?"睇團隊跟進":"＋ 安排今日"}<span aria-hidden="true">↗</span></Link><Link className="personal-text-link" href={manager?"/today":"/board"}>{manager?"我的今日安排":"打開客戶"}<span aria-hidden="true">→</span></Link></div>}
   <div className="personal-cover-signoff"><span>{manager?"TEAM JOURNAL":"MY DAILY JOURNAL"}</span><span aria-hidden="true">━━━━━━━━</span><span>{today.slice(5).replace("-"," / ")}</span></div>
  </div>
  <div className={`personal-cover-photo personal-photo-${avatar?.key||"default"}`}>
   {avatar?<img src="/api/account/avatar" alt={`${label} 嘅個人封面相片`} width={853} height={1280} fetchPriority="high"/>:<span className="personal-monogram" aria-hidden="true">{name.slice(0,1)}</span>}
   <div className="personal-photo-caption"><span>PERSONAL JOURNAL</span><b>{label}</b><span>{manager?"帶住團隊，行前一步。":"每一次跟進，都係新一頁。"}</span></div>
   <span className="personal-photo-corner" aria-hidden="true">↗</span>
  </div>
 </section>;
}
