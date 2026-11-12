import {redirect} from "next/navigation";
import {isDate} from "@/lib/weeks";
export default async function ReviewPage({searchParams}:{searchParams:Promise<{week?:string}>}){const {week}=await searchParams;redirect(isDate(week)?`/admin?week=${week}`:"/admin");}
