import { NextRequest, NextResponse } from "next/server";
import { orm } from "@/lib/db-compat";
import {
  isPaypalConfigured,
  createPaypalOrder,
  capturePaypalOrder,
} from "@/lib/payments/paypal";
import { sendFundsReceivedEmail } from "@/lib/proposals/funds-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isPaypalConfigured()) {
    return NextResponse.json({ error: "PayPal not configured" }, { status: 503 });
  }
  const action = new URL(req.url).searchParams.get("action");

  const proposal: any = await orm.crm_Proposals.findFirst({
    where: { shareToken: token, deletedAt: null },
  });
  if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "create") {
    try {
      const order = await createPaypalOrder({
        amount: parseFloat(proposal.grandTotal) || 0,
        currency: proposal.currency,
        description: `Proposal #${proposal.number ?? ""} — ${proposal.title}`,
      });
      await orm.crm_Proposals.update({
        where: { id: proposal.id },
        data: { paypalOrderId: order.id, paymentProvider: "paypal" },
      });
      return NextResponse.json({ orderId: order.id });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "PayPal create failed" },
        { status: 500 },
      );
    }
  }

  if (action === "capture") {
    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    try {
      const capture: any = await capturePaypalOrder(orderId);
      if (capture?.status !== "COMPLETED") {
        return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
      }
      const captureId =
        capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? orderId;
      const now = new Date().toISOString();
      if (proposal.status !== "PAID") {
        await orm.crm_Proposals.update({
          where: { id: proposal.id },
          data: { status: "PAID", paidAt: now, paypalCaptureId: captureId, updatedAt: now },
        });
        await orm.crm_Proposal_Activity.create({
          data: {
            id: crypto.randomUUID(),
            proposalId: proposal.id,
            actorId: null,
            action: "PAID",
            meta: { provider: "paypal", captureId },
            createdAt: now,
          },
        });
        if (proposal.linkedInvoiceId) {
          await orm.invoices.update({
            where: { id: proposal.linkedInvoiceId },
            data: { status: "PAID", paidTotal: proposal.grandTotal, balanceDue: "0", updatedAt: now },
          });
        }
        await sendFundsReceivedEmail(proposal);
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "PayPal capture failed" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
