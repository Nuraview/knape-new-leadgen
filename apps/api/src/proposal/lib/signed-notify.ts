/**
 * Best-effort emails around signing, ported from apps/web/lib/proposals/
 * signed-notify.ts + signed-copy.ts + funds-email.ts. None of these may throw
 * into the approve/payment path — a client who just signed must never see an
 * error because a courtesy email failed.
 */
import { sendMarketingEmail } from "../../marketing/lib/email-provider";
import { PAYMENT_METHOD_META, type PaymentMethod } from "./payment-methods";

// Who gets told when a client signs. Hardcoded default, same as legacy.
const NOTIFY_TO = "varshith@nuraview.com";

function money(currency: string, n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** "A proposal was signed" alert to the team — fired on client approval. */
export async function sendProposalSignedNotification(p: {
  title: string;
  number: number | null;
  currency: string;
  signerName: string;
  signerEmail: string | null;
  method: PaymentMethod;
  total: number;
  fee: number;
  ip: string | null;
  shareToken: string;
}) {
  try {
    const fmt = (n: number) => money(p.currency, n);
    const methodLabel = PAYMENT_METHOD_META[p.method]?.label ?? p.method;
    const num = String(p.number ?? "").padStart(4, "0");

    const html = `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
        <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Proposal signed</div>
        <h1 style="font-size:22px;margin:8px 0 16px">${p.title} <span style="color:#a8a29e;font-weight:400">· #${num}</span></h1>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#78716c">Signed by</td><td style="text-align:right"><strong>${p.signerName}</strong>${p.signerEmail ? ` · ${p.signerEmail}` : ""}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Payment method</td><td style="text-align:right">${methodLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Processing fee</td><td style="text-align:right">${fmt(p.fee)}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Total agreed</td><td style="text-align:right"><strong>${fmt(p.total)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#78716c">IP address</td><td style="text-align:right">${p.ip ?? "—"}</td></tr>
        </table>
        <p style="font-size:13px;color:#78716c;margin-top:18px">Invoice the client per the chosen payment method.</p>
      </div>`;

    await sendMarketingEmail({
      to: NOTIFY_TO,
      subject: `✅ Signed: ${p.title} (#${num}) — ${money(p.currency, p.total)} via ${methodLabel}`,
      html,
    });
  } catch (e) {
    console.error("[signed-notify] failed:", e);
  }
}

/** Confirmation copy emailed to the SIGNER — their record of the agreement. */
export async function sendSignedCopyToClient(p: {
  to: string | null | undefined;
  signerName: string;
  title: string;
  number: number | null;
  currency: string;
  total: number;
  method: PaymentMethod;
  url: string | null;
  companyName?: string | null;
}) {
  try {
    if (!p.to) return;
    const methodLabel = PAYMENT_METHOD_META[p.method]?.label ?? p.method;
    const num = String(p.number ?? "").padStart(4, "0");
    const who = p.companyName || "the team";

    const html = `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
        <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Signed — thank you</div>
        <h1 style="font-size:22px;margin:8px 0 14px">Hi ${p.signerName},</h1>
        <p style="font-size:15px;line-height:1.6;color:#44403c">
          Thanks for signing <strong>${p.title}</strong> (#${num}). Here's your copy for the records.
        </p>
        <table style="width:100%;font-size:14px;border-collapse:collapse;margin:14px 0">
          <tr><td style="padding:6px 0;color:#78716c">Total</td><td style="text-align:right"><strong>${money(p.currency, p.total)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Payment method</td><td style="text-align:right">${methodLabel}</td></tr>
        </table>
        ${p.url ? `<a href="${p.url}" style="display:inline-block;background:#1c1917;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9999px;font-size:14px;font-weight:500">View your proposal</a>` : ""}
        <p style="font-size:13px;color:#a8a29e;margin-top:18px">${who} will be in touch shortly.</p>
      </div>`;

    await sendMarketingEmail({
      to: p.to,
      subject: `Your signed proposal — ${p.title}`,
      html,
    });
  } catch (e) {
    console.error("[signed-copy] failed:", e);
  }
}

/**
 * "Funds received — thank you" to the client, fired when a proposal is paid
 * (Stripe webhook / PayPal capture). Plain HTML rather than the legacy
 * react-email template — same copy, no react-email dependency on this stack.
 */
export async function sendFundsReceivedEmail(proposal: {
  title: string;
  currency: string;
  grandTotal: string | number;
  approvedByName?: string | null;
  approvedByEmail?: string | null;
  clientEmail?: string | null;
}) {
  try {
    const to = proposal.approvedByEmail || proposal.clientEmail;
    if (!to) return;

    const n =
      typeof proposal.grandTotal === "string"
        ? parseFloat(proposal.grandTotal)
        : proposal.grandTotal;
    const amount = money(proposal.currency, Number.isFinite(n) ? n : 0);

    const html = `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
        <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Payment received</div>
        <h1 style="font-size:22px;margin:8px 0 14px">Thank you${proposal.approvedByName ? `, ${proposal.approvedByName}` : ""}!</h1>
        <p style="font-size:15px;line-height:1.6;color:#44403c">
          We've received your payment of <strong>${amount}</strong> for
          <strong>${proposal.title}</strong>. We'll be in touch shortly to kick things off.
        </p>
      </div>`;

    await sendMarketingEmail({
      to,
      subject: `Funds received — ${proposal.title}`,
      html,
    });
  } catch (e) {
    console.error("[funds-email] failed:", e);
  }
}
