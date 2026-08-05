import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { generateProposalPdf } from "@/lib/proposals/pdf/generate";
import { uploadProposalPdf } from "@/lib/proposals/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Chromium print of the public page can take a while on a cold lambda.
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { proposalId } = await params;

  const proposal: any = await orm.crm_Proposals.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [lineItems, settings] = await Promise.all([
    orm.crm_Proposal_LineItems.findMany({
      where: { proposalId: proposal.id },
      orderBy: { position: "asc" },
    }),
    orm.proposal_Settings.findFirst(),
  ]);
  proposal.lineItems = lineItems ?? [];

  // Chromium-print of the real public page (needs a share token — mint one on
  // first download so the exact designed PDF is always available).
  if (!proposal.shareToken) {
    const { generateShareToken } = await import("@/lib/proposals/share-token");
    proposal.shareToken = generateShareToken();
    await orm.crm_Proposals.update({
      where: { id: proposal.id },
      data: { shareToken: proposal.shareToken },
    });
  }

  const { pdf } = await generateProposalPdf(proposal, settings);

  // Best-effort cache of the storage key.
  try {
    const key = await uploadProposalPdf(proposal.id, pdf);
    await orm.crm_Proposals.update({
      where: { id: proposal.id },
      data: { pdfStorageKey: key, pdfGeneratedAt: new Date().toISOString() },
    });
  } catch (e) {
    console.error("[proposal pdf] store failed:", e);
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="proposal-${proposal.number ?? proposal.id}.pdf"`,
    },
  });
}
