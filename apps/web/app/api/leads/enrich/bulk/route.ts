// POST /api/leads/enrich/bulk
//   body: {
//     filter?: "highlighted" | "unenriched" | "all",
//     limit?: number (default 50, max 500),
//     mode?: "manual" | "deep" (default "manual"),
//   }
// Queues enrichment for a batch of leads. Used to backfill historical
// rows or top up after adjusting the auto-trigger gate. Honors the same
// dedup + budget rules as the per-lead route — the function itself
// performs the gating, so even a runaway bulk call is bounded by the
// daily budget cap.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeadEnrichment, crmLeads } from "@/drizzle/schema";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    filter: z
      .enum(["highlighted", "unenriched", "all", "with_client_info"])
      .default("unenriched"),
    limit: z.number().int().positive().max(500).default(50),
    mode: z.enum(["manual", "deep"]).default("manual"),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

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

  // Build the predicate. We always require company-not-null since the
  // waterfall needs a company to do anything useful.
  const baseConditions = [
    isNull(crmLeads.deletedAt),
    isNull(crmLeads.irrelevantAt),
    isNotNull(crmLeads.company),
  ];
  if (body.filter === "highlighted") {
    baseConditions.push(isNotNull(crmLeads.highlightedAt));
  } else if (body.filter === "unenriched") {
    baseConditions.push(isNull(crmLeads.enrichedAt));
  } else if (body.filter === "with_client_info") {
    baseConditions.push(eq(crmLeads.hasClientInfo, true));
  }

  const candidates = await db
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(and(...baseConditions))
    .orderBy(desc(crmLeads.createdAt))
    .limit(body.limit);

  if (candidates.length === 0) {
    return NextResponse.json({ queued: 0 });
  }

  // Insert audit rows in one INSERT-many. Sending events one at a time
  // is fine — Inngest's send() batches under the hood.
  const nowIso = new Date().toISOString();
  const auditRows = candidates.map((c) => ({
    id: crypto.randomUUID(),
    leadId: c.id,
    status: "PENDING" as const,
    mode: body.mode,
    fields:
      body.mode === "deep"
        ? ["linkedinUrl", "email", "firstName", "lastName", "phone"]
        : ["linkedinUrl", "email", "firstName", "lastName"],
    triggeredBy: session.user.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const inserted = await db
    .insert(crmLeadEnrichment)
    .values(auditRows)
    .returning({ id: crmLeadEnrichment.id, leadId: crmLeadEnrichment.leadId });

  // Reflect PENDING on the leads.
  const leadIds = inserted.map((r) => r.leadId);
  await db
    .update(crmLeads)
    .set({ enrichmentStatus: "PENDING", updatedAt: nowIso })
    .where(sql`${crmLeads.id} = ANY(${leadIds})`);

  // Fan out events.
  await inngest.send(
    inserted.map((r) => ({
      name: "enrich/lead.run",
      data: {
        leadId: r.leadId,
        enrichmentId: r.id,
        mode: body.mode,
        triggeredBy: session.user.id,
      },
    })),
  );

  return NextResponse.json({
    queued: inserted.length,
    mode: body.mode,
    filter: body.filter,
  });
}
