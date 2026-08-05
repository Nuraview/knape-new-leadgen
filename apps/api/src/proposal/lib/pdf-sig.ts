import { createHmac, timingSafeEqual } from "crypto";

// The public proposal page accepts `?pdf=<sig>` to render in PDF mode (static,
// no view tracking). The sig is an HMAC of the share token so clients can't
// forge it to dodge view tracking. Kept in its own module — the page imports
// this, and must NOT pull in the heavy chromium printer.

function secret(): string {
  const s =
    process.env.PROPOSAL_PDF_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("PROPOSAL_PDF_SECRET / AUTH_SECRET not configured");
  return s;
}

export function signPdfRender(shareToken: string): string {
  return createHmac("sha256", secret())
    .update(`proposal-pdf:${shareToken}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyPdfRender(shareToken: string, sig: string | undefined): boolean {
  if (!sig) return false;
  try {
    const expected = Buffer.from(signPdfRender(shareToken));
    const got = Buffer.from(sig);
    return expected.length === got.length && timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}
