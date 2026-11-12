import { NextResponse } from "next/server";
export function GET() { return NextResponse.json({ error: "請改用 Telegram 助手" }, { status: 410 }); }
export const POST = GET;
