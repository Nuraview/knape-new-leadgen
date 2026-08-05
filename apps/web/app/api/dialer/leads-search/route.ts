import { NextRequest, NextResponse } from "next/server";

import { and, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lead-contacts for the dialer: only leads with a phone number.
// With ?q= → name/company/phone search (picker). Without → recent list
// (the dialer's Contacts tab). (/api/leads doesn't expose phone, hence
// this route.)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const listAll = req.nextUrl.searchParams.get("all") === "1";
  if (!listAll && (!q || q.length < 2)) {
    return NextResponse.json({ leads: [] });
  }

  const hasPhone = and(
    isNull(crmLeads.deletedAt),
    isNotNull(crmLeads.phone),
    sql`${crmLeads.phone} <> ''`,
  );
  const pattern = q ? `%${q}%` : null;

  const leads = await db
    .select({
      id: crmLeads.id,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      company: crmLeads.company,
      phone: crmLeads.phone,
      phoneSecondary: crmLeads.phoneSecondary,
    })
    .from(crmLeads)
    .where(
      pattern
        ? and(
            hasPhone,
            or(
              ilike(crmLeads.firstName, pattern),
              ilike(crmLeads.lastName, pattern),
              ilike(crmLeads.company, pattern),
              ilike(crmLeads.phone, pattern),
            ),
          )
        : hasPhone,
    )
    .orderBy(sql`${crmLeads.createdAt} DESC NULLS LAST`)
    .limit(listAll ? 200 : 8);

  return NextResponse.json({ leads });
}
