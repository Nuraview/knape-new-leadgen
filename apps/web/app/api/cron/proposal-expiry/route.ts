import { NextRequest, NextResponse } from "next/server";
import { orm } from "@/lib/db-compat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured → allow (dev)
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const expiring: any[] = await orm.crm_Proposals.findMany({
    where: {
      status: { in: ["SENT", "VIEWED"] },
      expiresAt: { lt: now },
      deletedAt: null,
    },
    select: { id: true },
  });

  for (const p of expiring) {
    await orm.crm_Proposals.update({
      where: { id: p.id },
      data: { status: "EXPIRED", updatedAt: now },
    });
    await orm.crm_Proposal_Activity.create({
      data: {
        id: crypto.randomUUID(),
        proposalId: p.id,
        actorId: null,
        action: "EXPIRED",
        createdAt: now,
      },
    });
  }

  return NextResponse.json({ expired: expiring.length });
}
