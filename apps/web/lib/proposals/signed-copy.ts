import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { PAYMENT_METHOD_META } from "@/types/proposal";

/**
 * Confirmation copy emailed to the SIGNER right after they sign — their record
 * of the agreement + a link back to the proposal. Best-effort; never throws
 * into the approval path.
 */
export async function sendSignedCopyToClient(p: {
  to: string | null | undefined;
  signerName: string;
  title: string;
  number: number | null;
  currency: string;
  total: number;
  method: "stripe" | "paypal" | "bank";
  url: string | null;
  companyName?: string | null;
}) {
  try {
    if (!p.to) return;
    const money = (n: number) => {
      try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, currencyDisplay: "narrowSymbol" }).format(n);
      } catch {
        return `$${n.toFixed(2)}`;
      }
    };
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
          <tr><td style="padding:6px 0;color:#78716c">Total</td><td style="text-align:right"><strong>${money(p.total)}</strong></td></tr>
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
