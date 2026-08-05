"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { generateShareToken, buildPublicProposalUrl } from "@/lib/proposals/share-token";
import { revalidatePath } from "next/cache";

/**
 * Ensure the proposal has a public share token and return its public URL.
 * - rotate: invalidate the old link and mint a fresh token.
 * - markSent: when sharing via Copy Link (manual dispatch), flip a DRAFT to
 *   SENT so it's tracked, just like the Send button. Preview passes nothing.
 */
export async function shareProposal(
  proposalId: string,
  opts: { rotate?: boolean; markSent?: boolean } = {},
) {
  const user = await getUser();

  const proposal = await orm.crm_Proposals.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");

  let token = proposal.shareToken as string | null;
  const now = new Date().toISOString();
  const data: Record<string, unknown> = {};

  if (!token || opts.rotate) {
    token = generateShareToken();
    data.shareToken = token;
  }

  const markSent = !!opts.markSent && proposal.status === "DRAFT";
  if (markSent) {
    data.status = "SENT";
    data.sentAt = now;
  }

  if (Object.keys(data).length) {
    data.updatedAt = now;
    await orm.crm_Proposals.update({ where: { id: proposalId }, data });
  }

  if (markSent) {
    await orm.crm_Proposal_Activity.create({
      data: {
        id: crypto.randomUUID(),
        proposalId,
        actorId: user.id,
        action: "SENT",
        meta: { via: "link" },
        createdAt: now,
      },
    });
  }

  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath("/proposals");
  return {
    token,
    url: buildPublicProposalUrl(proposal.number, proposal.clientSlug, token),
  };
}
