"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { revalidatePath } from "next/cache";

interface RegisterAssetInput {
  proposalId: string;
  storageKey: string;
  title?: string | null;
  kind?: "PDF" | "IMAGE";
  fileSize?: number | null;
  category?: "RECENT" | "GENERAL";
  featured?: boolean;
  externalUrl?: string | null;
}

export async function registerProposalAsset(input: RegisterAssetInput) {
  await getUser();

  const count = await orm.crm_Proposal_Assets.count({
    where: { proposalId: input.proposalId },
  });

  await orm.crm_Proposal_Assets.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: input.proposalId,
      position: count,
      kind: input.kind ?? "PDF",
      title: input.title ?? null,
      storageKey: input.storageKey,
      fileSize: input.fileSize ?? null,
      category: input.category ?? "GENERAL",
      featured: input.featured ?? false,
      externalUrl: input.externalUrl ?? null,
      createdAt: new Date().toISOString(),
    },
  });

  revalidatePath(`/proposals/${input.proposalId}`);
  return { success: true };
}

export async function updateProposalAsset(
  assetId: string,
  proposalId: string,
  patch: { featured?: boolean; category?: "RECENT" | "GENERAL"; title?: string; externalUrl?: string | null },
) {
  await getUser();
  await orm.crm_Proposal_Assets.update({ where: { id: assetId }, data: patch });
  revalidatePath(`/proposals/${proposalId}`);
  return { success: true };
}

export interface PortfolioConfig {
  recentTitle?: string;
  generalTitle?: string;
  note?: string;
  links?: { label?: string; url?: string }[];
  // legacy single link (read for back-compat)
  linkUrl?: string;
  linkLabel?: string;
  // v4 hero / presentation (rendered on the public proposal page)
  subtitle?: string;
  /** Second-line accent word after the title (e.g. "Proposal"). null = hide. */
  titleAccentWord?: string | null;
  /** Small tagline under the logo (e.g. "DEVELOPMENT"). null/empty = hide. */
  logoTagline?: string | null;
  /** Role shown under the client name in the "Prepared for" card. */
  preparedForRole?: string | null;
  /** Show the Investment total in the "Prepared for" card. */
  showInvestment?: boolean;
  /** "Valid for N days" in the hero meta. null = hide. */
  validDays?: number | null;
  /** Hide the "Valid for …" pill even when a validity date exists. */
  showValidity?: boolean;
}

export async function updatePortfolioConfig(proposalId: string, config: PortfolioConfig) {
  await getUser();
  await orm.crm_Proposals.update({
    where: { id: proposalId },
    data: { portfolioConfig: config },
  });
  revalidatePath(`/proposals/${proposalId}`);
  return { success: true };
}

export async function removeProposalAsset(assetId: string, proposalId: string) {
  await getUser();
  await orm.crm_Proposal_Assets.delete({ where: { id: assetId } });
  revalidatePath(`/proposals/${proposalId}`);
  return { success: true };
}
