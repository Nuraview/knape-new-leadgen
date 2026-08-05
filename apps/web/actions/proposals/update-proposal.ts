"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { Decimal } from "decimal.js";
import {
  computeProposalTotals,
  computeFixedPriceTotals,
  computeLineTotal,
} from "@/lib/proposals/totals";
import { updateProposalSchema } from "@/types/proposal";
import { serializeDecimals } from "@/lib/serialize-decimals";
import { revalidatePath } from "next/cache";

export async function updateProposal(raw: unknown) {
  await getUser();
  const input = updateProposalSchema.parse(raw);

  const existing = await orm.crm_Proposals.findUnique({
    where: { id: input.id },
  });
  if (!existing) throw new Error("Proposal not found");
  // Allow edits until the client decides; block only signed/paid/rejected/expired.
  if (["APPROVED", "REJECTED", "PAID", "EXPIRED"].includes(existing.status)) {
    throw new Error("This proposal is already decided and can't be edited");
  }

  const lineItems = input.lineItems ?? [];
  const taxRateIds = lineItems.map((l) => l.taxRateId).filter(Boolean) as string[];
  const taxRates = taxRateIds.length
    ? await orm.invoice_TaxRates.findMany({ where: { id: { in: taxRateIds } } })
    : [];
  const rateMap = new Map<string, Decimal>(
    taxRates.map((t: { id: string; rate: unknown }) => [
      t.id,
      new Decimal(String(t.rate)),
    ]),
  );

  const lineInputs = lineItems.map((l) => ({
    quantity: new Decimal(l.quantity),
    unitPrice: new Decimal(l.unitPrice),
    discountPercent: new Decimal(l.discountPercent),
    taxRate: l.taxRateId ? (rateMap.get(l.taxRateId) ?? new Decimal(0)) : new Decimal(0),
  }));

  const pricingMode = input.pricingMode ?? existing.pricingMode;
  const fee = new Decimal(input.transactionFee ?? 0);
  const totals =
    pricingMode === "FIXED"
      ? computeFixedPriceTotals(new Decimal(input.fixedPrice ?? 0), fee)
      : computeProposalTotals(lineInputs, fee);

  const now = new Date().toISOString();

  await orm.crm_Proposals.update({
    where: { id: input.id },
    data: {
      title: input.title ?? existing.title,
      accountId: input.accountId ?? existing.accountId,
      contactId: input.contactId ?? existing.contactId,
      currency: input.currency ?? existing.currency,
      clientName: input.clientName ?? existing.clientName,
      clientCompany: input.clientCompany ?? existing.clientCompany,
      clientEmail: input.clientEmail ?? existing.clientEmail,
      clientAddress: input.clientAddress ?? existing.clientAddress,
      projectName: input.projectName ?? existing.projectName,
      proposalDate: input.proposalDate ? input.proposalDate.toISOString() : existing.proposalDate,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : existing.expiresAt,
      theme: input.theme ?? existing.theme,
      designPresetId: input.designPresetId ?? existing.designPresetId,
      designTokens: input.designTokens ?? existing.designTokens,
      videoUrl: input.videoUrl ?? existing.videoUrl,
      scheduleCallUrl: input.scheduleCallUrl ?? existing.scheduleCallUrl,
      sections: input.sections ?? existing.sections,
      pricingMode,
      fixedPrice: input.fixedPrice != null ? String(input.fixedPrice) : existing.fixedPrice,
      subtotal: totals.subtotal.toString(),
      discountTotal: totals.discountTotal.toString(),
      taxTotal: totals.taxTotal.toString(),
      transactionFee: totals.transactionFee.toString(),
      grandTotal: totals.grandTotal.toString(),
      depositAmount: input.depositAmount != null ? String(input.depositAmount) : existing.depositAmount,
      brandColor: input.brandColor ?? existing.brandColor,
      publicNotes: input.publicNotes ?? existing.publicNotes,
      internalNotes: input.internalNotes ?? existing.internalNotes,
      updatedAt: now,
    },
  });

  // Replace line items wholesale (draft-only edit).
  if (input.lineItems) {
    await orm.crm_Proposal_LineItems.deleteMany({
      where: { proposalId: input.id },
    });
    if (lineItems.length) {
      await orm.crm_Proposal_LineItems.createMany({
        data: lineItems.map((l, i) => {
          const lt = computeLineTotal(lineInputs[i]);
          return {
            id: crypto.randomUUID(),
            proposalId: input.id,
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
  }

  revalidatePath(`/proposals/${input.id}`);
  return serializeDecimals({ id: input.id });
}
