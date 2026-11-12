import {redirect} from "next/navigation";
export default async function SeasonsPage({searchParams}:{searchParams:Promise<{agent?:string}>}){const {agent}=await searchParams;redirect(agent&&/^[0-9a-f-]{36}$/i.test(agent)?`/board?agent=${agent}`:"/board");}
