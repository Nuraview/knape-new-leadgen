// Pusher → CRM: scrape run lifecycle events. Bearer-auth'd, same key as
// /api/ingest/upwork. Events land in the `scrape_runs` table and drive the
// live pipeline status shown on /leads.

import { NextRequest, NextResponse } from "next/server";

import { sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireScraperAuth } from "@/lib/ingest-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StartSchema = z.object({
  type: z.literal("start"),
  tick_id: z.string().min(1),
  query: z.string().min(1),
  jobs_expected: z.number().int().nonnegative().optional(),
});

const FinishSchema = z.object({
  type: z.literal("finish"),
  tick_id: z.string().min(1),
  query: z.string().min(1),
  status: z.enum(["completed", "failed", "skipped"]),
  jobs_found: z.number().int().nonnegative().optional(),
  jobs_inserted: z.number().int().nonnegative().optional(),
  jobs_updated: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

// Fired by the pusher at container startup. Marks any rows still in
// `running` status as failed — they're orphans from a previous pusher
// instance that was killed mid-scrape (e.g. by a docker-compose rebuild).
const CleanupSchema = z.object({
  type: z.literal("cleanup"),
});

const EventSchema = z.union([StartSchema, FinishSchema, CleanupSchema]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireScraperAuth(req);
  if (unauth) return unauth;

  let event: z.infer<typeof EventSchema>;
  try {
    const json = await req.json();
    event = EventSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid event", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type === "cleanup") {
    const res: any = await db.execute(dsql`
      UPDATE "scrape_runs"
         SET "status"      = 'failed',
             "finished_at" = now(),
             "error"       = 'interrupted — pusher restarted before finish event'
       WHERE "status" = 'running'
    `);
    return NextResponse.json({
      ok: true,
      cleaned: (res as any)?.rowCount ?? 0,
    });
  }

  if (event.type === "start") {
    await db.execute(dsql`
      INSERT INTO "scrape_runs"
        ("tick_id", "query", "status", "jobs_expected")
      VALUES
        (${event.tick_id}, ${event.query}, 'running', ${event.jobs_expected ?? null})
    `);
    return NextResponse.json({ ok: true });
  }

  // finish — update the most recent running row for this tick_id + query
  await db.execute(dsql`
    UPDATE "scrape_runs"
    SET
      "status"        = ${event.status},
      "finished_at"   = now(),
      "jobs_found"    = ${event.jobs_found ?? null},
      "jobs_inserted" = ${event.jobs_inserted ?? null},
      "jobs_updated"  = ${event.jobs_updated ?? null},
      "error"         = ${event.error ?? null}
    WHERE "id" = (
      SELECT "id" FROM "scrape_runs"
      WHERE "tick_id" = ${event.tick_id}
        AND "query"   = ${event.query}
        AND "status"  = 'running'
      ORDER BY "started_at" DESC
      LIMIT 1
    )
  `);
  return NextResponse.json({ ok: true });
}
