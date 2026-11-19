import { NextRequest, NextResponse } from "next/server";
import { runScraperBatch } from "@/server/scrapers/batch";
import { batchDb } from "@/server/scrapers/batch-db";
import { isCronAuthorized, runnerMode } from "@/server/scrapers/policy";
import { runScraper } from "@/server/scrapers/run-scraper";
import { createScraperStore } from "@/server/scrapers/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (runnerMode() !== "batch") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Batch runner is disabled",
      mode: runnerMode(),
    });
  }
  try {
    return NextResponse.json(
      await runScraperBatch({
        store: createScraperStore(batchDb),
        execute: (row, adminId) => runScraper(row, adminId, batchDb),
        poshEnabled: process.env.POSH_CRON_ENABLED?.toLowerCase() === "true",
      })
    );
  } catch (error) {
    console.error("Scraper batch failed", error);
    return NextResponse.json(
      { error: "Scraper batch failed" },
      { status: 500 }
    );
  }
}

export const POST = GET;
