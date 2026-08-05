import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { PAYMENT_METHOD_META } from "@/types/proposal";

// Who gets told when a client signs a proposal. Hardcoded default; change here.
const NOTIFY_TO = "varshith@nuraview.com";

/**
 * "A proposal was signed" alert to the team — fired on client approval.
 * Best-effort: never throws into the approval path.
 */
export async function sendProposalSignedNotification(p: {
  title: string;
  number: number | null;
  currency: string;
  signerName: string;
  signerEmail: string | null;
  method: "stripe" | "paypal" | "bank";
  total: number;
  fee: number;
  ip: string | null;
  shareToken: string;
}) {
  try {
    const money = (n: number) => {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, currencyDisplay: "narrowSymbol" }).format(n);
      } catch {
        return `$${n.toFixed(2)}`;
      }
    };
    const methodLabel = PAYMENT_METHOD_META[p.method]?.label ?? p.method;
    const num = String(p.number ?? "").padStart(4, "0");

    const html = `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917">
        <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#a8a29e">Proposal signed</div>
        <h1 style="font-size:22px;margin:8px 0 16px">${p.title} <span style="color:#a8a29e;font-weight:400">· #${num}</span></h1>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#78716c">Signed by</td><td style="text-align:right"><strong>${p.signerName}</strong>${p.signerEmail ? ` · ${p.signerEmail}` : ""}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Payment method</td><td style="text-align:right">${methodLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Processing fee</td><td style="text-align:right">${money(p.fee)}</td></tr>
          <tr><td style="padding:6px 0;color:#78716c">Total agreed</td><td style="text-align:right"><strong>${money(p.total)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#78716c">IP address</td><td style="text-align:right">${p.ip ?? "—"}</td></tr>
        </table>
        <p style="font-size:13px;color:#78716c;margin-top:18px">Invoice the client per the chosen payment method.</p>
      </div>`;

    await sendMarketingEmail({
      to: NOTIFY_TO,
      subject: `✅ Signed: ${p.title} (#${num}) — ${money(p.total)} via ${methodLabel}`,
      html,
    });
  } catch (e) {
    console.error("[signed-notify] failed:", e);
  }
}
