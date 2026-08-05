import { NextRequest, NextResponse } from "next/server";
import { orm } from "@/lib/db-compat";
import { rejectProposalSchema } from "@/types/proposal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const parsed = rejectProposalSchema.safeParse(await req.json().catch(() => ({})));
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;

  const proposal: any = await orm.crm_Proposals.findFirst({
    where: { shareToken: token, deletedAt: null },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!["SENT", "VIEWED"].includes(proposal.status)) {
    return NextResponse.json({ error: "Already responded to." }, { status: 409 });
  }

  const now = new Date().toISOString();
  await orm.crm_Proposals.update({
    where: { id: proposal.id },
    data: { status: "REJECTED", decisionAt: now, rejectionReason: reason, updatedAt: now },
  });
  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      actorId: null,
      action: "REJECTED",
      meta: { reason },
      createdAt: now,
    },
  });

  return NextResponse.json({ success: true });
}
