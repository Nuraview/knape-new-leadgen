// POST /api/leads/[id]/enrich
//   body: { mode?: "manual" | "deep" }
// Creates a PENDING crm_Lead_Enrichment audit row, sends the
// enrich/lead.run Inngest event, returns { enrichmentId, queued: true }.
//
// The function (inngest/functions/enrich-lead.ts) flips the row through
// RUNNING → COMPLETED/FAILED/SKIPPED. The drawer can poll
// GET /api/leads/[id]/enrichment-status (added in this file's sibling
// route) to surface the current state to the reviewer.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeadEnrichment, crmLeads } from "@/drizzle/schema";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    // "manual" runs the standard cheap waterfall on demand. "deep" adds
    // the Prospeo phone-find step + escalation to the existing E2B agent
    // for the long tail. We map "manual" → enrich-lead's mode "manual"
    // and "deep" → "deep". "auto" is reserved for the ingest path.
    mode: z.enum(["manual", "deep"]).default("manual"),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json().catch(() => ({}));
    body = BodySchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Confirm the lead exists (and isn't soft-deleted) before queueing.
  // Otherwise the function would 404 internally and we'd leave a stranded
  // PENDING audit row pointing at a missing FK.
  const [lead] = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .limit(1);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Insert audit row in PENDING. Inngest will flip it to RUNNING when the
  // function picks up the event.
  const nowIso = new Date().toISOString();
  const [audit] = await db
    .insert(crmLeadEnrichment)
    .values({
      // crypto.randomUUID is on Node 19+; this app is on Node 20.
      id: crypto.randomUUID(),
      leadId: id,
      status: "PENDING",
      mode: body.mode,
      // We always target the same fields with the waterfall — the strategy
      // decides which ones it can actually fill. Listing them here is for
      // operator audit ("what was this run after?").
      fields:
        body.mode === "deep"
          ? ["linkedinUrl", "email", "firstName", "lastName", "phone"]
          : ["linkedinUrl", "email", "firstName", "lastName"],
      triggeredBy: session.user.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .returning({ id: crmLeadEnrichment.id });

  // Reflect on the lead row so the drawer can show "Running" without
  // joining the audit table on every fetch.
  await db
    .update(crmLeads)
    .set({ enrichmentStatus: "PENDING", updatedAt: nowIso })
    .where(eq(crmLeads.id, id));

  await inngest.send({
    name: "enrich/lead.run",
    data: {
      leadId: id,
      enrichmentId: audit.id,
      mode: body.mode,
      triggeredBy: session.user.id,
    },
  });

  return NextResponse.json({
    queued: true,
    enrichmentId: audit.id,
    mode: body.mode,
  });
}

// GET /api/leads/[id]/enrich
//   Returns the latest enrichment run for the lead, plus the lead's
//   projected status. The drawer polls this to render the status pill.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  const [latest] = await db
    .select({
      id: crmLeadEnrichment.id,
      status: crmLeadEnrichment.status,
      mode: crmLeadEnrichment.mode,
      error: crmLeadEnrichment.error,
      costUsd: crmLeadEnrichment.costUsd,
      createdAt: crmLeadEnrichment.createdAt,
      updatedAt: crmLeadEnrichment.updatedAt,
    })
    .from(crmLeadEnrichment)
    .where(eq(crmLeadEnrichment.leadId, id))
    .orderBy(desc(crmLeadEnrichment.createdAt))
    .limit(1);

  return NextResponse.json({ latest: latest ?? null });
}
