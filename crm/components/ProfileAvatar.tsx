import type {ProfileAvatarInfo} from "@/lib/profile-avatar";
import {profileAvatarUrl} from "@/lib/avatar-url";
export default function ProfileAvatar({avatar,large=false}:{avatar:ProfileAvatarInfo;large?:boolean}){
 return <span className={`profile-avatar profile-avatar-${avatar.key}${large?" profile-avatar-large":""}`}><img key={`${avatar.accountId}:${avatar.key}`} src={profileAvatarUrl(avatar)} alt={`${avatar.label} 嘅個人頭像`} width={large?96:40} height={large?96:40}/></span>;
}
