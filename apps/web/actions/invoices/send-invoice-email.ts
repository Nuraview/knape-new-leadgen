"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { getInvoicePdfStream } from "@/lib/invoices/storage";
import { InvoiceEmail } from "@/emails/InvoiceEmail";
import { render } from "@react-email/render";

interface SendInvoiceEmailInput {
  invoiceId: string;
  to: string;
  subject?: string;
  message?: string;
}

export async function sendInvoiceEmail(input: SendInvoiceEmailInput) {
  const user = await getUser();

  const invoice = await orm.invoices.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      createdBy: true,
      pdfStorageKey: true,
      account: { select: { name: true } },
    },
  });

  if (invoice.createdBy !== user.id && !user.is_admin) {
    throw new Error("Forbidden");
  }

  if (!invoice.pdfStorageKey) {
    throw new Error("Invoice PDF not generated yet. Please issue the invoice first.");
  }

  // Fetch PDF from storage
  const pdfBody = await getInvoicePdfStream(invoice.pdfStorageKey);
  if (!pdfBody) {
    throw new Error("Failed to retrieve invoice PDF from storage");
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of pdfBody as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const pdfBuffer = Buffer.concat(chunks);

  const subject =
    input.subject ?? `Invoice ${invoice.number ?? invoice.id} — ${invoice.account.name}`;
  const message =
    input.message ?? "Please find attached your invoice as a PDF.";

  const html = await render(
    InvoiceEmail({
      number: invoice.number ?? "",
      message,
      userLanguage: user.userLanguage ?? "en",
    })
  );

  // Sent via Mailu SMTP (creative-hive) — Resend removed per client mandate.
  const sendRes = await sendMarketingEmail({
    to: input.to,
    subject,
    html,
    attachments: [
      {
        filename: `invoice-${invoice.number ?? invoice.id}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
  if (sendRes.error) throw new Error(`Email failed: ${sendRes.error}`);

  // Update status to SENT only if currently ISSUED
  if (invoice.status === "ISSUED") {
    await orm.invoices.update({
      where: { id: invoice.id },
      data: {
        status: "SENT",
        activity: {
          create: {
            actorId: user.id,
            action: "SENT",
            meta: { to: input.to, subject },
          },
        },
      },
    });
  } else {
    // Log activity even if we don't change status
    await orm.invoice_Activity.create({
      data: {
        invoiceId: invoice.id,
        actorId: user.id,
        action: "EMAIL_SENT",
        meta: { to: input.to, subject },
      },
    });
  }

  return { success: true };
}
