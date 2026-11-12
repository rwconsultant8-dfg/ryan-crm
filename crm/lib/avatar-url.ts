/** Account identity changes the URL so a reused image element reloads on account switches. */
export function profileAvatarUrl(avatar:{key:string;accountId?:string}) {
 const query=new URLSearchParams({portrait:avatar.key,v:"3"});
 if(avatar.accountId)query.set("account",avatar.accountId);
 return `/api/account/avatar?${query}`;
}
