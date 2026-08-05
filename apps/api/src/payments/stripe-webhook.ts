/**
 * Stripe webhook — the only trustworthy signal that money actually moved.
 *
 * Ported from apps/web/app/api/webhooks/stripe/route.ts. The invoice branch is
 * dropped: Invoices is on the kill list (zero rows in two production
 * databases), so writing to it would be dead code.
 *
 * NEVER mark a proposal paid from the browser. The client-side confirmation
 * resolves before Stripe has finalised, and a page that can be closed mid-flight
 * is not a payment record. This endpoint is the one that flips status to PAID.
 *
 * Signature verification uses the RAW body. Any middleware that parses JSON
 * before this handler breaks it silently — the signature stops matching and
 * every real event is rejected as a forgery. Hence c.req.text(), first thing.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import {
  crmProposalActivity,
  crmProposals,
  invoices,
} from "../database/crm-schema";
import { getStripe, isStripeConfigured } from "./stripe";
import resendWebhook from "../marketing/resend-webhook";

const stripeWebhook = new Hono();

/*
 * Resend's delivery events share this mount (/api/webhooks). Grouping the two
 * providers here keeps the nginx story simple: one prefix, no exceptions, and
 * nothing left pointing at the legacy app.
 */
stripeWebhook.route("/", resendWebhook);

stripeWebhook.post("/stripe", async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret) {
    // 503, not 200. Stripe retries a 5xx, so events queued while the keys were
    // missing are redelivered once they are set instead of being lost.
    return c.json({ error: "Stripe is not configured" }, 503);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  const raw = await c.req.text();

  /*
   * Verify against the live secret, then the TEST secret.
   *
   * Test-mode events are signed with a different webhook secret, and a test
   * invoice's payment has to be able to mark itself paid or "test the whole
   * flow without money moving" stops one step short of the finish line. Trying
   * both is safe: each is an HMAC check that either matches or does not, and an
   * event forged against neither is still rejected.
   */
  let event: ReturnType<ReturnType<typeof getStripe>["webhooks"]["constructEvent"]>;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (liveError) {
    const testSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
    try {
      if (!testSecret) throw liveError;
      event = getStripe("test").webhooks.constructEvent(
        raw,
        signature,
        testSecret,
      );
    } catch {
      console.error("[stripe] signature verification failed:", liveError);
      return c.json({ error: "Invalid signature" }, 400);
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as {
      id: string;
      amount?: number;
      metadata?: { invoiceId?: string };
    };

    /*
     * A STANDALONE invoice — the non-signer path (invoice/public.ts). The
     * comment above about "Invoices is on the kill list" is no longer true:
     * signed proposals convert into that table and manual invoices are created
     * in it, so this is the only place either kind gets marked paid. Keyed on
     * metadata.invoiceId, which the intent carries from creation.
     */
    /*
     * Null when this payment is not tied to an invoice; otherwise whether the
     * invoice is now settled IN FULL. A deposit clearing must not flip the
     * proposal to PAID — 75% is still owed and the proposal is the thing the
     * team reads to know that.
     */
    let invoiceSettled: boolean | null = null;

    const invoiceId = intent.metadata?.invoiceId;
    if (invoiceId) {
      const [inv] = await crmDb
        .select({
          status: invoices.status,
          grandTotal: invoices.grandTotal,
          paidTotal: invoices.paidTotal,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      if (inv && inv.status !== "PAID") {
        /*
         * CREDIT what was actually paid — this used to write
         * paidTotal = grandTotal and balanceDue = 0 for any successful intent,
         * which is only right when the invoice is paid in one go. On a staged
         * proposal ("25% upfront") the deposit clearing would have closed the
         * invoice and written the remaining 75% off the books.
         *
         * intent.amount is in the currency's minor unit. Zero-decimal
         * currencies (JPY and friends) do not divide by 100 — none are in use
         * here, and getting that wrong silently under-credits by 100x, so the
         * invoice's own numbers are the fallback whenever the amount does not
         * arrive.
         */
        const grand = Number(inv.grandTotal) || 0;
        const paidBefore = Number(inv.paidTotal) || 0;
        const credited =
          typeof intent.amount === "number" && intent.amount > 0
            ? intent.amount / 100
            : Math.max(0, grand - paidBefore);

        /*
         * One statement, because delivery is at-least-once and this now ADDS
         * rather than overwrites. The arithmetic runs in the database against
         * the current row, and the intent id is recorded in billingSnapshot so
         * a redelivery of the same event matches nothing and credits nothing.
         */
        await crmDb.execute(sql`
          UPDATE "Invoices"
             SET "paidTotal"  = LEAST("grandTotal"::numeric,
                                      ROUND("paidTotal"::numeric + ${credited.toFixed(2)}::numeric, 2)),
                 "balanceDue" = GREATEST(0::numeric,
                                      ROUND("grandTotal"::numeric - LEAST("grandTotal"::numeric,
                                        ROUND("paidTotal"::numeric + ${credited.toFixed(2)}::numeric, 2)), 2)),
                 "status"     = CASE
                                  WHEN ROUND("paidTotal"::numeric + ${credited.toFixed(2)}::numeric, 2)
                                       >= "grandTotal"::numeric - 0.01 THEN 'PAID'
                                  ELSE 'PARTIAL'
                                END,
                 "billingSnapshot" = COALESCE("billingSnapshot", '{}'::jsonb)
                   || jsonb_build_object(
                        'payments',
                        COALESCE("billingSnapshot"->'payments', '[]'::jsonb)
                          || jsonb_build_array(jsonb_build_object(
                               'intentId', ${intent.id}::text,
                               'amount',   ${credited.toFixed(2)}::text))),
                 "updatedAt"  = now()
           WHERE "id" = ${invoiceId}::uuid
             AND NOT COALESCE("billingSnapshot"->'payments', '[]'::jsonb)
                     @> jsonb_build_array(jsonb_build_object('intentId', ${intent.id}::text))
        `);

        invoiceSettled = paidBefore + credited >= grand - 0.01;
      }
    }

    const [proposal] = await crmDb
      .select({ id: crmProposals.id, status: crmProposals.status })
      .from(crmProposals)
      .where(
        and(
          eq(crmProposals.stripePaymentIntentId, intent.id),
          isNull(crmProposals.deletedAt),
        ),
      )
      .limit(1);

    // Stripe redelivers on any non-2xx, and at-least-once delivery is the
    // contract — so this must be idempotent. Already PAID is a success, not a
    // conflict, or a retry storm would flip it repeatedly.
    if (proposal && proposal.status !== "PAID") {
      const now = new Date();
      // A part payment is recorded, not celebrated: the proposal stays where it
      // is so the balance keeps showing up as work still to be collected.
      const settledInFull = invoiceSettled !== false;

      if (settledInFull) {
        await crmDb
          .update(crmProposals)
          .set({ status: "PAID", paidAt: now, updatedAt: now })
          .where(eq(crmProposals.id, proposal.id));
      }

      await crmDb.insert(crmProposalActivity).values({
        id: crypto.randomUUID(),
        proposalId: proposal.id,
        actorId: null,
        action: settledInFull ? "PAID" : "DEPOSIT_PAID",
        meta: { paymentIntentId: intent.id },
        createdAt: now,
      });
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as {
      id: string;
      last_payment_error?: { message?: string };
    };
    // Recorded, not acted on: a failed attempt is normal (wrong CVC, retry) and
    // must not undo an approval or alarm anyone.
    const [proposal] = await crmDb
      .select({ id: crmProposals.id })
      .from(crmProposals)
      .where(eq(crmProposals.stripePaymentIntentId, intent.id))
      .limit(1);

    if (proposal) {
      await crmDb.insert(crmProposalActivity).values({
        id: crypto.randomUUID(),
        proposalId: proposal.id,
        actorId: null,
        action: "PAYMENT_FAILED",
        meta: {
          paymentIntentId: intent.id,
          error: intent.last_payment_error?.message ?? null,
        },
        createdAt: new Date(),
      });
    }
  }

  // 200 for every other event type. Stripe disables endpoints that keep
  // failing, so an unhandled type must not look like an error.
  return c.json({ received: true });
});

export default stripeWebhook;
