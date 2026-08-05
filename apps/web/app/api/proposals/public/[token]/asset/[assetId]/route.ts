import { NextRequest, NextResponse } from "next/server";
import { orm } from "@/lib/db-compat";
import { getProposalFilePresignedUrl } from "@/lib/proposals/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; assetId: string }> },
) {
  const { token, assetId } = await params;

  const proposal: any = await orm.crm_Proposals.findFirst({
    where: { shareToken: token, deletedAt: null },
    select: { id: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset: any = await orm.crm_Proposal_Assets.findFirst({
    where: { id: assetId, proposalId: proposal.id },
  });
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Blob assets store a full public URL; legacy MinIO assets store a key.
  const key: string = asset.storageKey;
  const url = /^https?:\/\//.test(key)
    ? key
    : await getProposalFilePresignedUrl(key, 300);
  return NextResponse.redirect(url);
}
