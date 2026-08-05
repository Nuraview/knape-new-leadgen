import { orm } from "@/lib/db-compat";

/**
 * Create a real Invoice from an approved proposal, carrying over client +
 * pricing. Idempotent: returns the existing linked invoice if already
 * converted. The proposal's stored line items / totals are the source of truth
 * (the approve flow persists client-adjusted quantities before calling this).
 */
export async function convertProposalToInvoice(
  proposalId: string,
  /**
   * What is due NOW on a staged proposal ("25% upfront"). The invoice keeps the
   * full contract value as grandTotal; only balanceDue is the upfront portion,
   * so paying it leaves the rest outstanding instead of closing the invoice.
   */
  opts?: { depositDue?: number | null },
): Promise<{ invoiceId: string; amount: number }> {
  const proposal: any = await orm.crm_Proposals.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");
  proposal.lineItems = await orm.crm_Proposal_LineItems.findMany({
    where: { proposalId: proposal.id },
    orderBy: { position: "asc" },
  });

  // Idempotency. Hands back what the EXISTING invoice still wants, so a second
  // signature on a part-paid proposal does not re-charge the whole contract.
  if (proposal.linkedInvoiceId) {
    const existing: any = await orm.invoices.findUnique({
      where: { id: proposal.linkedInvoiceId },
    });
    return {
      invoiceId: proposal.linkedInvoiceId,
      amount:
        parseFloat(existing?.balanceDue ?? proposal.grandTotal) ||
        parseFloat(proposal.grandTotal) ||
        0,
    };
  }

  // Ensure there is an account to attach the invoice to (Invoices.accountId is
  // NOT NULL). Cold-outreach proposals may have none → create a minimal one.
  let accountId: string | null = proposal.accountId;
  if (!accountId) {
    const name =
      proposal.clientCompany || proposal.clientName || proposal.title || "Client";
    const acct = await orm.crm_Accounts.create({
      data: {
        v: 0,
        name,
        status: "Active",
        createdBy: proposal.createdBy,
      },
    });
    accountId = acct.id;
    await orm.crm_Proposals.update({
      where: { id: proposalId },
      data: { accountId },
    });
  }

  const now = new Date().toISOString();
  const invoiceId = crypto.randomUUID();

  const grand = parseFloat(proposal.grandTotal) || 0;
  const depositDue =
    opts?.depositDue != null &&
    Number.isFinite(opts.depositDue) &&
    opts.depositDue > 0 &&
    opts.depositDue < grand
      ? Math.round(opts.depositDue * 100) / 100
      : null;
  const dueNow = depositDue ?? grand;

  await orm.invoices.create({
    data: {
      id: invoiceId,
      accountId,
      createdBy: proposal.createdBy,
      currency: proposal.currency,
      status: "ISSUED",
      issueDate: now,
      subtotal: proposal.subtotal,
      discountTotal: proposal.discountTotal,
      vatTotal: proposal.taxTotal,
      grandTotal: proposal.grandTotal,
      balanceDue: dueNow.toFixed(2),
      publicNotes: `Generated from proposal #${proposal.number ?? ""} — ${proposal.title}`,
      createdAt: now,
      updatedAt: now,
    },
  });

  const items = proposal.lineItems ?? [];
  if (items.length) {
    await orm.invoiceLineItems.createMany({
      data: items.map((li: any, i: number) => ({
        id: crypto.randomUUID(),
        invoiceId,
        position: li.position ?? i,
        productId: li.productId ?? null,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountPercent: li.discountPercent,
        taxRateId: li.taxRateId ?? null,
        taxRateSnapshot: li.taxRateSnapshot ?? null,
        lineSubtotal: li.lineSubtotal,
        lineVat: li.lineVat,
        lineTotal: li.lineTotal,
      })),
    });
  }

  await orm.crm_Proposals.update({
    where: { id: proposalId },
    data: { linkedInvoiceId: invoiceId, updatedAt: now },
  });

  // The amount to COLLECT now, not the contract value.
  return { invoiceId, amount: dueNow };
}
