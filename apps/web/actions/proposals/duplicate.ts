"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { serializeDecimals } from "@/lib/serialize-decimals";
import { nextProposalNumber } from "@/lib/proposals/numbering";
import { slugify } from "@/lib/proposals/slug";
import { revalidatePath } from "next/cache";

const LINE_FIELDS = [
  "position", "productId", "description", "quantity", "unitPrice",
  "discountPercent", "taxRateId", "taxRateSnapshot", "lineSubtotal",
  "lineVat", "lineTotal", "clientAdjustable", "minQty", "maxQty", "tiers",
] as const;

async function cloneLineItems(sourceId: string, targetId: string) {
  const items: any[] = await orm.crm_Proposal_LineItems.findMany({
    where: { proposalId: sourceId },
    orderBy: { position: "asc" },
  });
  if (!items.length) return;
  await orm.crm_Proposal_LineItems.createMany({
    data: items.map((li) => {
      const row: any = { id: crypto.randomUUID(), proposalId: targetId };
      for (const f of LINE_FIELDS) row[f] = li[f];
      return row;
    }),
  });
}

// Fields copied verbatim when cloning the proposal body (no client/lifecycle state).
function bodyFields(src: any) {
  return {
    title: src.title,
    currency: src.currency,
    theme: src.theme,
    designPresetId: src.designPresetId,
    designTokens: src.designTokens,
    portfolioConfig: src.portfolioConfig,
    videoUrl: src.videoUrl,
    scheduleCallUrl: src.scheduleCallUrl,
    sections: src.sections,
    pricingMode: src.pricingMode,
    fixedPrice: src.fixedPrice,
    subtotal: src.subtotal,
    discountTotal: src.discountTotal,
    taxTotal: src.taxTotal,
    transactionFee: src.transactionFee,
    grandTotal: src.grandTotal,
    depositAmount: src.depositAmount,
    brandColor: src.brandColor,
    logoStorageKey: src.logoStorageKey,
    publicNotes: src.publicNotes,
    internalNotes: src.internalNotes,
  };
}

export async function duplicateProposal(id: string) {
  const user = await getUser();
  const src: any = await orm.crm_Proposals.findUnique({ where: { id } });
  if (!src) throw new Error("Proposal not found");

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const number = await nextProposalNumber();

  await orm.crm_Proposals.create({
    data: {
      id: newId,
      ...bodyFields(src),
      title: `${src.title} (Copy)`,
      number,
      clientSlug: slugify(src.clientCompany || src.clientName || src.title),
      status: "DRAFT",
      isTemplate: false,
      createdBy: user.id,
      accountId: src.accountId,
      contactId: src.contactId,
      clientName: src.clientName,
      clientCompany: src.clientCompany,
      projectName: src.projectName,
      createdAt: now,
      updatedAt: now,
    },
  });
  await cloneLineItems(id, newId);
  revalidatePath("/proposals");
  return serializeDecimals({ id: newId });
}

export async function saveAsTemplate(proposalId: string, templateName: string) {
  const user = await getUser();
  const src: any = await orm.crm_Proposals.findUnique({ where: { id: proposalId } });
  if (!src) throw new Error("Proposal not found");

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Templates carry no client data, share token, or signature.
  await orm.crm_Proposals.create({
    data: {
      id: newId,
      ...bodyFields(src),
      number: null,
      clientSlug: null,
      status: "DRAFT",
      isTemplate: true,
      templateName,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  await cloneLineItems(proposalId, newId);
  revalidatePath("/proposals");
  return serializeDecimals({ id: newId });
}

export async function createFromTemplate(templateId: string) {
  const user = await getUser();
  const src: any = await orm.crm_Proposals.findUnique({ where: { id: templateId } });
  if (!src || !src.isTemplate) throw new Error("Template not found");

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const number = await nextProposalNumber();

  await orm.crm_Proposals.create({
    data: {
      id: newId,
      ...bodyFields(src),
      number,
      clientSlug: slugify(src.title),
      status: "DRAFT",
      isTemplate: false,
      sourceTemplateId: templateId,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  await cloneLineItems(templateId, newId);
  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: newId,
      actorId: user.id,
      action: "CREATED",
      meta: { fromTemplate: templateId },
      createdAt: now,
    },
  });
  revalidatePath("/proposals");
  return serializeDecimals({ id: newId });
}
