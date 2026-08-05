/**
 * Payment methods the client can pick when signing, with the processing fee
 * each carries. Ported from apps/web/types/proposal.ts (PAYMENT_METHOD_META).
 *
 * The percentages are AUTHORITATIVE on the server: the approve route recomputes
 * the fee from the method rather than trusting the number the page displayed.
 */
export type PaymentMethod = "stripe" | "paypal" | "bank";

export const PAYMENT_METHOD_META: Record<
  PaymentMethod,
  { label: string; pct: number; hint: string }
> = {
  stripe: { label: "Stripe (Card)", pct: 3.5, hint: "+3.5% processing fee" },
  paypal: { label: "PayPal", pct: 5, hint: "+5% processing fee" },
  bank: { label: "Direct transfer", pct: 0, hint: "no fee" },
};

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  return value === "stripe" || value === "paypal" ? value : "bank";
}
