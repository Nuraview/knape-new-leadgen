/**
 * The credential on a public invoice link.
 *
 * DERIVED, not stored: an HMAC of the invoice id under a server secret. That
 * keeps a share link out of the Invoices table entirely — no new column on a
 * live accounting table, nothing to migrate, and no way for a row to exist
 * with a leaked-but-unrevokable token still in it. Rotating BETTER_AUTH_SECRET
 * invalidates every outstanding link at once, which is the behaviour wanted if
 * one ever leaks.
 *
 * Verification is constant-time. Guessing is not feasible (32 hex chars of a
 * SHA-256 HMAC), and the invoice id itself is a uuid, so the URL leaks nothing
 * about how many invoices exist.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return (
    process.env.INVOICE_LINK_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    "nuraview-invoice-link"
  );
}

export function invoiceToken(invoiceId: string): string {
  return createHmac("sha256", secret())
    .update(`invoice:${invoiceId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyInvoiceToken(
  invoiceId: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const expected = invoiceToken(invoiceId);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** The client-facing URL, on the invoices host when one is configured. */
export function buildInvoiceUrl(invoiceId: string): string {
  const base = (
    process.env.INVOICE_PUBLIC_URL ||
    process.env.PROPOSAL_PUBLIC_URL ||
    ""
  ).replace(/\/$/, "");
  return `${base}/invoice/${invoiceId}?t=${invoiceToken(invoiceId)}`;
}
