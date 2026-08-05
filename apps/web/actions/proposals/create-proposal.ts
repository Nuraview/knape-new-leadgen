"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { Decimal } from "decimal.js";
import {
  computeProposalTotals,
  computeFixedPriceTotals,
  computeLineTotal,
} from "@/lib/proposals/totals";
import { createProposalSchema } from "@/types/proposal";
import { serializeDecimals } from "@/lib/serialize-decimals";
import { nextProposalNumber } from "@/lib/proposals/numbering";
import { slugify } from "@/lib/proposals/slug";

export async function createProposal(raw: unknown) {
  const user = await getUser();
  const input = createProposalSchema.parse(raw);

  // Resolve tax rates referenced by line items.
  const taxRateIds = input.lineItems
    .map((l) => l.taxRateId)
    .filter(Boolean) as string[];
  const taxRates = taxRateIds.length
    ? await orm.invoice_TaxRates.findMany({ where: { id: { in: taxRateIds } } })
    : [];
  const rateMap = new Map<string, Decimal>(
    taxRates.map((t: { id: string; rate: unknown }) => [
      t.id,
      new Decimal(String(t.rate)),
    ]),
  );

  const lineInputs = input.lineItems.map((l) => ({
    quantity: new Decimal(l.quantity),
    unitPrice: new Decimal(l.unitPrice),
    discountPercent: new Decimal(l.discountPercent),
    taxRate: l.taxRateId ? (rateMap.get(l.taxRateId) ?? new Decimal(0)) : new Decimal(0),
  }));

  const fee = new Decimal(input.transactionFee ?? 0);
  const totals =
    input.pricingMode === "FIXED"
      ? computeFixedPriceTotals(new Decimal(input.fixedPrice ?? 0), fee)
      : computeProposalTotals(lineInputs, fee);

  const proposalId = crypto.randomUUID();
  const now = new Date().toISOString();
  const number = await nextProposalNumber();
  const slug = slugify(input.clientCompany || input.clientName || input.title);

  await orm.crm_Proposals.create({
    data: {
      id: proposalId,
      number,
      clientSlug: slug,
      title: input.title,
      status: "DRAFT",
      isTemplate: false,
      createdBy: user.id,
      accountId: input.accountId ?? null,
      contactId: input.contactId ?? null,
      currency: input.currency,
      clientName: input.clientName ?? null,
      clientCompany: input.clientCompany ?? null,
      clientEmail: input.clientEmail ?? null,
      clientAddress: input.clientAddress ?? null,
      projectName: input.projectName ?? null,
      proposalDate: input.proposalDate ? input.proposalDate.toISOString() : null,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
      theme: input.theme ?? "creative",
      designPresetId: input.designPresetId ?? null,
      designTokens: input.designTokens ?? null,
      videoUrl: input.videoUrl ?? null,
      scheduleCallUrl: input.scheduleCallUrl ?? null,
      sections: input.sections ?? [],
      pricingMode: input.pricingMode,
      fixedPrice: input.fixedPrice != null ? String(input.fixedPrice) : null,
      subtotal: totals.subtotal.toString(),
      discountTotal: totals.discountTotal.toString(),
      taxTotal: totals.taxTotal.toString(),
      transactionFee: totals.transactionFee.toString(),
      grandTotal: totals.grandTotal.toString(),
      depositAmount: input.depositAmount != null ? String(input.depositAmount) : null,
      brandColor: input.brandColor ?? null,
      publicNotes: input.publicNotes ?? null,
      internalNotes: input.internalNotes ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });

  if (input.lineItems.length) {
    await orm.crm_Proposal_LineItems.createMany({
      data: input.lineItems.map((l, i) => {
        const lt = computeLineTotal(lineInputs[i]);
        return {
          id: crypto.randomUUID(),
          proposalId,
          position: l.position ?? i,
          productId: l.productId ?? null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent),
          taxRateId: l.taxRateId ?? null,
          taxRateSnapshot: l.taxRateId
            ? (rateMap.get(l.taxRateId)?.toString() ?? null)
            : null,
          lineSubtotal: lt.lineSubtotal.toString(),
          lineVat: lt.lineVat.toString(),
          lineTotal: lt.lineTotal.toString(),
          clientAdjustable: l.clientAdjustable ?? false,
          minQty: l.minQty != null ? String(l.minQty) : null,
          maxQty: l.maxQty != null ? String(l.maxQty) : null,
          tiers: l.tiers && l.tiers.length ? l.tiers : null,
        };
      }),
    });
  }

  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId,
      actorId: user.id,
      action: "CREATED",
      createdAt: now,
    },
  });

  return serializeDecimals({ id: proposalId, number, clientSlug: slug });
}
