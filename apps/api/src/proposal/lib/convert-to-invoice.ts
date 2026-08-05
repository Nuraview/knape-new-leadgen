/**
 * Create a real Invoice from an approved proposal, carrying over client +
 * pricing. Ported from apps/web/lib/proposals/convert-to-invoice.ts.
 *
 * Idempotent: returns the existing linked invoice if already converted. The
 * proposal's STORED line items and totals are the source of truth — the
 * approve flow persists client-adjusted quantities before calling this.
 *
 * This is also what makes VK's "non-signers" case work: the invoice row it
 * creates is the same shape the manual invoicing screen writes, so a client
 * who pays without signing and a client who signs land in the same table.
 */
import { asc, eq } from "drizzle-orm";
import crmDb from "../../database/crm";
import {
  crmAccounts,
  crmProposalLineItems,
  crmProposals,
  invoiceLineItems,
  invoices,
} from "../../database/crm-schema";

export async function convertProposalToInvoice(
  proposalId: string,
  /**
   * What is due NOW when the proposal is billed in stages ("25% upfront").
   *
   * The invoice keeps the full contract value as its grandTotal — that is what
   * was agreed and what the document must show — while balanceDue is only the
   * upfront portion. Paying it therefore does not close the invoice: the
   * webhook credits the payment and leaves the rest outstanding, which is how
   * the remaining 75% stays on the books instead of vanishing at the moment
   * the deposit clears.
   */
  opts?: { depositDue?: number | null },
): Promise<{ invoiceId: string; amount: number }> {
  const [proposal] = await crmDb
    .select()
    .from(crmProposals)
    .where(eq(crmProposals.id, proposalId))
    .limit(1);
  if (!proposal) throw new Error("Proposal not found");

  // Idempotency. The amount handed back is what the EXISTING invoice still
  // wants — its balance, not the contract value, or a second signature on a
  // part-paid proposal would re-charge the whole thing.
  if (proposal.linkedInvoiceId) {
    const [existing] = await crmDb
      .select({ balanceDue: invoices.balanceDue })
      .from(invoices)
      .where(eq(invoices.id, proposal.linkedInvoiceId))
      .limit(1);
    return {
      invoiceId: proposal.linkedInvoiceId,
      amount:
        parseFloat(existing?.balanceDue ?? proposal.grandTotal) ||
        parseFloat(proposal.grandTotal) ||
        0,
    };
  }

  const lineItems = await crmDb
    .select()
    .from(crmProposalLineItems)
    .where(eq(crmProposalLineItems.proposalId, proposal.id))
    .orderBy(asc(crmProposalLineItems.position));

  // Invoices.accountId is NOT NULL; cold-outreach proposals may have no
  // account yet → create a minimal one.
  let accountId = proposal.accountId;
  if (!accountId) {
    const name =
      proposal.clientCompany ||
      proposal.clientName ||
      proposal.title ||
      "Client";
    accountId = crypto.randomUUID();
    await crmDb.insert(crmAccounts).values({
      id: accountId,
      v: 0,
      name,
      status: "Active",
      createdBy: proposal.createdBy,
    });
    await crmDb
      .update(crmProposals)
      .set({ accountId })
      .where(eq(crmProposals.id, proposalId));
  }

  const now = new Date();
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

  await crmDb.insert(invoices).values({
    id: invoiceId,
    accountId,
    createdBy: proposal.createdBy,
    currency: proposal.currency,
    status: "ISSUED",
    issueDate: now,
    subtotal: proposal.subtotal,
    discountTotal: proposal.discountTotal,
    vatTotal: proposal.taxTotal,
    /*
     * Carry the client's identity and the PROCESSING FEE onto the invoice.
     *
     * Without this the invoice read "Subtotal $600 / Amount due $621" with the
     * $21 unexplained — which is exactly what makes a payment page look like a
     * scam. billingSnapshot is the column the legacy schema already reserved
     * for a point-in-time copy of who was billed and how the total was built.
     */
    billingSnapshot: {
      clientName: proposal.clientName,
      clientCompany: proposal.clientCompany,
      clientEmail: proposal.clientEmail,
      clientAddress: proposal.clientAddress,
      processingFee: proposal.processingFee,
      paymentMethod: proposal.paymentMethod,
      proposalNumber: proposal.number,
      /*
       * The staged-billing story, so the pay page can say "25% upfront due
       * now, balance on completion" instead of showing a total that does not
       * match the button.
       */
      depositDue: depositDue == null ? null : depositDue.toFixed(2),
      depositRemaining:
        depositDue == null
          ? null
          : (Math.round((grand - depositDue) * 100) / 100).toFixed(2),
    },
    grandTotal: proposal.grandTotal,
    balanceDue: dueNow.toFixed(2),
    publicNotes: `Generated from proposal #${proposal.number ?? ""} — ${proposal.title}`,
    /*
     * Carry the proposal's TEST marker onto the invoice.
     *
     * Without this, a test proposal signed end-to-end produced a LIVE invoice —
     * so the one flow VK most wanted to rehearse (send, sign, pay) could not be
     * rehearsed without a real charge at the last step. A proposal marked
     * `[test]` now converts into a test invoice, which pays on Stripe's test
     * keys with card 4242.
     */
    internalNotes: proposal.internalNotes?.startsWith("[test]")
      ? "[test] from test proposal"
      : null,
    createdAt: now,
    updatedAt: now,
  });

  if (lineItems.length) {
    await crmDb.insert(invoiceLineItems).values(
      lineItems.map((li, i) => ({
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
    );
  }

  await crmDb
    .update(crmProposals)
    .set({ linkedInvoiceId: invoiceId, updatedAt: now })
    .where(eq(crmProposals.id, proposalId));

  // The amount to COLLECT now, not the contract value — the caller mints a
  // PaymentIntent from it.
  return { invoiceId, amount: dueNow };
}
