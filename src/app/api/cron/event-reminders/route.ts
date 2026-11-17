import { NextRequest, NextResponse } from "next/server";
import { sendDueEventReminders } from "@/server/utils/event-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // This route can send alerts; unlike read-only jobs, fail closed if the
  // scheduler secret is absent, including on preview deployments.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sendDueEventReminders();
    return NextResponse.json(
      { ok: result.failed === 0, ...result },
      {
        status: result.failed ? 500 : 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("Event reminders failed", error);
    return NextResponse.json(
      { error: "Event reminders failed" },
      { status: 500 }
    );
  }
}
