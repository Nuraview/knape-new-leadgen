import { render } from "@react-email/render";
import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { FundsReceivedEmail } from "@/emails/FundsReceivedEmail";

/**
 * "Funds received — thank you" email to the client (and a copy to the team),
 * fired when a proposal is paid (Stripe webhook / PayPal capture). Best-effort:
 * never throws into the payment path.
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

    const n = typeof proposal.grandTotal === "string" ? parseFloat(proposal.grandTotal) : proposal.grandTotal;
    let amountStr = `${proposal.currency} ${Number.isFinite(n) ? n.toFixed(2) : proposal.grandTotal}`;
    try {
      amountStr = new Intl.NumberFormat(undefined, { style: "currency", currency: proposal.currency }).format(n);
    } catch {
      /* keep fallback */
    }

    const html = await render(
      FundsReceivedEmail({ title: proposal.title, clientName: proposal.approvedByName, amount: amountStr }),
    );
    await sendMarketingEmail({
      to,
      subject: `Funds received — ${proposal.title}`,
      html,
    });
  } catch (e) {
    console.error("[funds-email] failed:", e);
  }
}
