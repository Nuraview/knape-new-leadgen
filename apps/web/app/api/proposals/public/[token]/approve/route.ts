import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { Decimal } from "decimal.js";
import { orm } from "@/lib/db-compat";
import { approveProposalSchema, PAYMENT_METHOD_META } from "@/types/proposal";
import { sendProposalSignedNotification } from "@/lib/proposals/signed-notify";
import { sendSignedCopyToClient } from "@/lib/proposals/signed-copy";
import { tierUnitPrice } from "@/lib/proposals/tiers";
import { decodeSignaturePng } from "@/lib/proposals/signature";
import { uploadProposalSignature } from "@/lib/proposals/storage";
import { computeLineTotal, computeProposalTotals } from "@/lib/proposals/totals";
import { convertProposalToInvoice } from "@/lib/proposals/convert-to-invoice";
import { depositSplit } from "@/lib/proposals/deposit";
import { isStripeConfigured, createProposalPaymentIntent } from "@/lib/payments/stripe";
import { isPaypalConfigured } from "@/lib/payments/paypal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let body: unknown;
  try {
    body = approveProposalSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = body as ReturnType<typeof approveProposalSchema.parse>;

  const proposal: any = await orm.crm_Proposals.findFirst({
    where: { shareToken: token, deletedAt: null },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Block only already-decided / expired proposals. A shared link (Copy Link)
  // leaves status DRAFT, so DRAFT/SENT/VIEWED must all be approvable — otherwise
  // a client who opens the link can view + sign but the approve POST 409s.
  if (["APPROVED", "REJECTED", "PAID", "EXPIRED"].includes(proposal.status)) {
    return NextResponse.json(
      { error: "This proposal can no longer be approved." },
      { status: 409 },
    );
  }
  // Fetch line items explicitly (facade findFirst doesn't hydrate `include`).
  proposal.lineItems = await orm.crm_Proposal_LineItems.findMany({
    where: { proposalId: proposal.id },
    orderBy: { position: "asc" },
  });

  const now = new Date().toISOString();
  const adjusted = input.adjustedQuantities ?? {};

  // ---- Recompute line items with client-adjusted quantities (authoritative) ----
  const lineInputs = (proposal.lineItems ?? []).map((li: any) => {
    const adj = adjusted[String(li.position)];
    const qty = li.clientAdjustable && adj ? new Decimal(adj) : new Decimal(li.quantity);
    // Volume tiers: effective unit price for the (possibly adjusted) quantity.
    const unit = tierUnitPrice(Number(li.unitPrice), qty.toNumber(), li.tiers);
    return {
      raw: li,
      quantity: qty,
      unitPrice: new Decimal(unit),
      discountPercent: new Decimal(li.discountPercent),
      taxRate: new Decimal(li.taxRateSnapshot ?? "0"),
    };
  });

  for (const l of lineInputs) {
    const lt = computeLineTotal(l);
    await orm.crm_Proposal_LineItems.update({
      where: { id: l.raw.id },
      data: {
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(), // lock in the agreed (tier) unit price
        lineSubtotal: lt.lineSubtotal.toString(),
        lineVat: lt.lineVat.toString(),
        lineTotal: lt.lineTotal.toString(),
      },
    });
  }

  // Dynamic processing fee: a % of the base total by chosen payment method
  // (Stripe 3.5% / PayPal 5% / Direct 0%). Authoritative server-side.
  const method = input.paymentMethod ?? "bank";
  const pct = new Decimal(PAYMENT_METHOD_META[method]?.pct ?? 0);
  const base = computeProposalTotals(lineInputs, new Decimal(0));
  const procFee = base.grandTotal.mul(pct).div(100).toDecimalPlaces(2);
  const totals = computeProposalTotals(lineInputs, procFee);

  // ---- Signature ----
  let signatureStorageKey: string | null = null;
  let signatureTypedName: string | null = null;
  if (input.signatureType === "DRAWN") {
    try {
      const png = decodeSignaturePng(input.signatureData);
      signatureStorageKey = await uploadProposalSignature(proposal.id, png);
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else {
    signatureTypedName = input.signatureData.slice(0, 200);
  }

  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    null;

  const settings: any = await orm.proposal_Settings.findFirst();

  await orm.crm_Proposals.update({
    where: { id: proposal.id },
    data: {
      status: "APPROVED",
      decisionAt: now,
      approvedByName: input.name,
      approvedByEmail: input.email ?? null,
      signatureType: input.signatureType,
      signatureTypedName,
      signatureStorageKey,
      signatureIpAddress: ip,
      paymentMethod: method,
      processingFee: procFee.toString(),
      subtotal: totals.subtotal.toString(),
      discountTotal: totals.discountTotal.toString(),
      taxTotal: totals.taxTotal.toString(),
      transactionFee: totals.transactionFee.toString(),
      grandTotal: totals.grandTotal.toString(),
      updatedAt: now,
    },
  });

  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      actorId: null,
      action: "APPROVED",
      meta: {
        name: input.name,
        email: input.email,
        signatureType: input.signatureType,
        paymentMethod: method,
        clientTimeline: input.clientTimeline ?? null,
        ip,
      },
      createdAt: now,
    },
  });

  /*
   * ---- Staged billing ----
   *
   * "25% upfront" is agreed on the proposal and used to be discarded at
   * signature: the client was asked for 100%. Split against the final,
   * fee-inclusive total so the deposit carries its share of the fee.
   */
  const split = depositSplit(proposal as never, totals.grandTotal.toNumber());

  // ---- Auto-generate invoice ----
  let invoiceId: string | null = null;
  let amount = split.dueNow;
  try {
    const inv = await convertProposalToInvoice(proposal.id, {
      depositDue: split.staged ? split.dueNow : null,
    });
    invoiceId = inv.invoiceId;
    amount = inv.amount;
    await orm.crm_Proposal_Activity.create({
      data: {
        id: crypto.randomUUID(),
        proposalId: proposal.id,
        actorId: null,
        action: "CONVERTED",
        meta: { invoiceId },
        createdAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("[proposal approve] convert failed:", e);
  }

  // ---- Notify the team that a proposal was signed (best-effort) ----
  await sendProposalSignedNotification({
    title: proposal.title,
    number: proposal.number,
    currency: proposal.currency,
    signerName: input.name,
    signerEmail: input.email ?? null,
    method,
    total: totals.grandTotal.toNumber(),
    fee: procFee.toNumber(),
    ip,
    shareToken: token,
  });

  // ---- Email the signer their copy (best-effort) ----
  {
    const host = hdrs.get("x-forwarded-host") || hdrs.get("host");
    const proto = hdrs.get("x-forwarded-proto") || "https";
    const url =
      host && proposal.number != null
        ? `${proto}://${host}/proposal/${proposal.number}/${proposal.clientSlug}?t=${token}`
        : null;
    await sendSignedCopyToClient({
      to: input.email,
      signerName: input.name,
      title: proposal.title,
      number: proposal.number,
      currency: proposal.currency,
      total: totals.grandTotal.toNumber(),
      method,
      url,
      companyName: settings?.companyName ?? null,
    });
  }

  /*
   * ---- Build payment response by method ----
   *
   * What is charged NOW: the deposit on a staged proposal, otherwise the whole
   * total. `amount` came back from the invoice, so re-signing a part-paid
   * proposal collects the outstanding balance rather than starting over.
   */
  let clientSecret: string | null = null;
  const chargeAmount = amount;

  if (method === "stripe") {
    if (isStripeConfigured() && chargeAmount > 0) {
      try {
        const intent = await createProposalPaymentIntent({
          amount: chargeAmount, // fee-inclusive
          currency: proposal.currency,
          description: `Proposal #${proposal.number ?? ""} — ${proposal.title}`,
          metadata: { proposalId: proposal.id, invoiceId: invoiceId ?? "" },
          receiptEmail: input.email ?? null,
        });
        clientSecret = intent.clientSecret;
        await orm.crm_Proposals.update({
          where: { id: proposal.id },
          data: {
            stripePaymentIntentId: intent.id,
            stripeCustomerId: intent.customerId,
            paymentProvider: "stripe",
          },
        });
      } catch (e) {
        console.error("[proposal approve] stripe intent failed:", e);
      }
    }
    return NextResponse.json({
      success: true,
      payment: { amount: chargeAmount, method: "stripe", clientSecret, invoiceId, fee: procFee.toNumber() },
    });
  }

  if (method === "paypal") {
    await orm.crm_Proposals.update({
      where: { id: proposal.id },
      data: { paymentProvider: "paypal" },
    });
    return NextResponse.json({
      success: true,
      payment: { amount, method: "paypal", clientSecret: null, invoiceId, paypalConfigured: isPaypalConfigured() },
    });
  }

  // bank transfer — record pending, return bank details
  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      actorId: null,
      action: "BANK_PENDING",
      meta: { amount },
      createdAt: new Date().toISOString(),
    },
  });
  const bank = settings
    ? {
        bankName: settings.bankName ?? null,
        bankAccountName: settings.bankAccountName ?? null,
        bankAccountNumber: settings.bankAccountNumber ?? null,
        bankIban: settings.bankIban ?? null,
        bankSwift: settings.bankSwift ?? null,
        bankRouting: settings.bankRouting ?? null,
        bankInstructions: settings.bankInstructions ?? null,
      }
    : null;
  return NextResponse.json({
    success: true,
    payment: { amount, method: "bank", clientSecret: null, invoiceId, bank },
  });
}
