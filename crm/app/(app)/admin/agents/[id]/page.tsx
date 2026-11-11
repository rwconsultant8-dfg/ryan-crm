import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
export default async function AgentBoard({params}:{params:Promise<{id:string}>}){await requireAdmin();const{id}=await params;redirect(`/board?agent=${encodeURIComponent(id)}`);}
