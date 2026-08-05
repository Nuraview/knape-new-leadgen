import { NextRequest, NextResponse } from "next/server";

import { inArray } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeadEnrichment, crmLeads } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// De-duplicate leads by (job title + company). The caller passes the set of
// lead ids it's looking at (e.g. the Kanban "Today" column); for each group of
// leads that share the same normalized title + company we keep one and delete
// the rest. Title is required to match — we never collapse title-less rows.

// Normalize a free-text field for matching: lowercase, collapse internal
// whitespace, trim. Null/blank → "".
function norm(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: { ids?: unknown; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? Array.from(
        new Set(body.ids.filter((x): x is string => typeof x === "string"))
      )
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No lead ids provided" }, { status: 400 });
  }

  // Load only the fields the dedupe rule needs.
  const rows = await db
    .select({
      id: crmLeads.id,
      company: crmLeads.company,
      jobTitle: crmLeads.jobTitle,
      extractedAt: crmLeads.extractedAt,
      createdAt: crmLeads.createdAt,
      reminderAt: crmLeads.reminderAt,
      lastContactedAt: crmLeads.lastContactedAt,
    })
    .from(crmLeads)
    .where(inArray(crmLeads.id, ids));

  type Row = (typeof rows)[number];

  // Group by (title + company). A title-less lead can't be matched, so skip it.
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const title = norm(r.jobTitle);
    if (!title) continue;
    const key = `${title}||${norm(r.company)}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  // Keeper preference: never throw away work in progress — prefer a lead we've
  // already contacted, then one with a reminder set, then the most recently
  // extracted. Everything else in the group is a victim.
  const score = (r: Row): number =>
    r.lastContactedAt ? 3 : r.reminderAt ? 2 : 1;
  const ts = (r: Row): number =>
    new Date(r.extractedAt ?? r.createdAt ?? 0).getTime();

  const victims: string[] = [];
  let duplicateGroups = 0;
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    duplicateGroups += 1;
    const sorted = [...g].sort((a, b) => {
      const s = score(b) - score(a);
      return s !== 0 ? s : ts(b) - ts(a);
    });
    victims.push(...sorted.slice(1).map((r) => r.id));
  }

  if (body.dryRun) {
    return NextResponse.json({
      dryRun: true,
      duplicateGroups,
      toDelete: victims.length,
    });
  }

  if (victims.length === 0) {
    return NextResponse.json({ deleted: 0, duplicateGroups: 0 });
  }

  // crm_Lead_Enrichment is onDelete:restrict, so clear those child rows first;
  // the lead's other FKs (views, embeddings, documents) cascade and activity
  // events set-null on their own.
  await db
    .delete(crmLeadEnrichment)
    .where(inArray(crmLeadEnrichment.leadId, victims));
  await db.delete(crmLeads).where(inArray(crmLeads.id, victims));

  return NextResponse.json({ deleted: victims.length, duplicateGroups });
}
