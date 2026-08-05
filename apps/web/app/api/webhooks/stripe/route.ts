import { NextRequest, NextResponse } from "next/server";
import { orm } from "@/lib/db-compat";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as { id: string; amount?: number };
    const proposal: any = await orm.crm_Proposals.findFirst({
      where: { stripePaymentIntentId: intent.id },
    });

    if (proposal && proposal.status !== "PAID") {
      const now = new Date().toISOString();

      /*
       * CREDIT what was paid; do not assume it settles the invoice.
       *
       * On a staged proposal ("25% upfront") this used to write
       * paidTotal = grandTotal / balanceDue = 0 the moment the deposit cleared,
       * writing the remaining 75% off the books and stamping the proposal PAID
       * while most of the money was still owed. intent.amount is in minor units.
       */
      let settled = true;
      if (proposal.linkedInvoiceId) {
        const inv: any = await orm.invoices.findUnique({
          where: { id: proposal.linkedInvoiceId },
        });
        const grand = parseFloat(inv?.grandTotal ?? proposal.grandTotal) || 0;
        const paidBefore = parseFloat(inv?.paidTotal ?? "0") || 0;
        const credited =
          typeof intent.amount === "number" && intent.amount > 0
            ? intent.amount / 100
            : Math.max(0, grand - paidBefore);
        const paidTotal = Math.min(
          grand,
          Math.round((paidBefore + credited) * 100) / 100,
        );
        const balance = Math.round(Math.max(0, grand - paidTotal) * 100) / 100;
        settled = balance <= 0.009;

        await orm.invoices.update({
          where: { id: proposal.linkedInvoiceId },
          data: {
            status: settled ? "PAID" : "PARTIAL",
            paidTotal: paidTotal.toFixed(2),
            balanceDue: balance.toFixed(2),
            updatedAt: now,
          },
        });
      }

      // A part payment is recorded, not celebrated — the proposal stays put so
      // the balance keeps showing as money still to collect.
      if (settled) {
        await orm.crm_Proposals.update({
          where: { id: proposal.id },
          data: { status: "PAID", paidAt: now, updatedAt: now },
        });
      }
      await orm.crm_Proposal_Activity.create({
        data: {
          id: crypto.randomUUID(),
          proposalId: proposal.id,
          actorId: null,
          action: settled ? "PAID" : "DEPOSIT_PAID",
          meta: { paymentIntentId: intent.id },
          createdAt: now,
        },
      });

      // "Funds received" email to the client (+ team bcc).
      const { sendFundsReceivedEmail } = await import("@/lib/proposals/funds-email");
      await sendFundsReceivedEmail(proposal);
    }
  }

  return NextResponse.json({ received: true });
}
