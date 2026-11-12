import { redirect } from "next/navigation";

// PDCA 已停用，保留舊連結嘅員工範圍。
export default async function RetiredPdcaPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  redirect(agent ? `/activity?agent=${encodeURIComponent(agent)}` : "/activity");
}
