/**
 * Stripe — proposal payments.
 *
 * Ported from apps/web/lib/payments/stripe.ts, unchanged in behaviour. Two
 * things worth knowing before touching it:
 *
 *   automatic_payment_methods  lets Stripe decide what to offer (card, and
 *                              Klarna where the buyer is eligible). Klarna
 *                              instalments are settled to us in full up front,
 *                              so the proposal is paid either way.
 *
 *   setup_future_usage         stores the card against a Customer so an
 *                              approved client can be recharged off-session
 *                              later on verbal consent. This is the reason the
 *                              account entity matters — RBI tokenisation rules
 *                              make off-session recharge unusable on an Indian
 *                              account. NuraView bills from a US/UK/EU entity,
 *                              so it is available.
 *
 * Fails closed: with no STRIPE_SECRET_KEY this throws rather than silently
 * pretending. A payment path that quietly does nothing is worse than one that
 * errors — the client thinks they have paid.
 */
import Stripe from "stripe";

let cached: Stripe | null = null;
let cachedTest: Stripe | null = null;

/**
 * TEST MODE lives alongside live mode, never instead of it.
 *
 * VK: "how can we do a complete test run without deducting any money?" Swapping
 * the keys in env would answer that and take real payments down for the
 * duration, so instead both key pairs are configured at once and the CALLER
 * picks. Only an invoice explicitly created as a test invoice resolves to the
 * test client — a client cannot opt themselves into free money by editing a URL,
 * because the mode is a property of the row, not of the request.
 */
export type StripeMode = "live" | "test";

export function isStripeConfigured(mode: StripeMode = "live"): boolean {
  return Boolean(
    mode === "test"
      ? process.env.STRIPE_TEST_SECRET_KEY
      : process.env.STRIPE_SECRET_KEY,
  );
}

/** The publishable key the browser needs, for the mode in play. */
export function stripePublishableKey(mode: StripeMode = "live"): string | null {
  return (
    (mode === "test"
      ? process.env.STRIPE_TEST_PUBLISHABLE_KEY
      : process.env.STRIPE_PUBLISHABLE_KEY) ?? null
  );
}

export function getStripe(mode: StripeMode = "live"): Stripe {
  if (mode === "test") {
    const key = process.env.STRIPE_TEST_SECRET_KEY;
    if (!key) throw new Error("STRIPE_TEST_SECRET_KEY is not configured");
    if (!cachedTest) cachedTest = new Stripe(key);
    return cachedTest;
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!cached) cached = new Stripe(process.env.STRIPE_SECRET_KEY);
  return cached;
}

/**
 * Methods NuraView never accepts, whatever the Stripe Dashboard says.
 *
 * automatic_payment_methods offers everything enabled on the account, and Stripe
 * switched crypto ("Crypto — powered by Link") on for accounts by default. We do
 * not take stablecoin, so every intent excludes it explicitly — that way one
 * Dashboard toggle flipping back cannot put it in front of a client again.
 *
 * Excluding is the right tool here rather than an explicit payment_method_types
 * list: the list would freeze the set at whatever is spelled out and error the
 * whole intent if one entry is not activated for the currency, killing payment
 * outright. The exclusion only ever subtracts.
 */
export const EXCLUDED_PAYMENT_METHOD_TYPES = ["crypto"] as const;

export type ProposalIntentArgs = {
  /** Major units — dollars, not cents. Converted here, once. */
  amount: number;
  currency: string;
  description: string;
  metadata: Record<string, string>;
  receiptEmail?: string | null;
};

export async function createProposalPaymentIntent(args: ProposalIntentArgs) {
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
      typeof intent.customer === "string"
        ? intent.customer
        : (intent.customer?.id ?? null),
  };
}
