import Stripe from "stripe";

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return cached;
}

interface IntentArgs {
  amount: number; // major units (e.g. dollars)
  currency: string;
  description: string;
  metadata: Record<string, string>;
  receiptEmail?: string | null;
}

/**
 * Methods NuraView never accepts, whatever the Stripe Dashboard has enabled.
 * Kept in step with apps/api/src/payments/stripe.ts — the legacy approve route
 * still mints intents, so excluding it in one app only would leave crypto on
 * offer for anyone paying through the old share links.
 */
export const EXCLUDED_PAYMENT_METHOD_TYPES = ["crypto"] as const;

/**
 * Create a PaymentIntent for an approved proposal. Enables automatic payment
 * methods (card, Klarna where eligible) and stores the card for future
 * off-session charges (verbal-consent recharge). Klarna installments are paid
 * to us in full up front.
 */
export async function createProposalPaymentIntent(args: IntentArgs) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(args.amount * 100),
    currency: args.currency.toLowerCase(),
    description: args.description,
    metadata: args.metadata,
    receipt_email: args.receiptEmail ?? undefined,
    automatic_payment_methods: { enabled: true },
    excluded_payment_method_types: [...EXCLUDED_PAYMENT_METHOD_TYPES],
    setup_future_usage: "off_session",
  });
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    customerId:
      typeof intent.customer === "string" ? intent.customer : intent.customer?.id ?? null,
  };
}
