"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { ProposalEmail } from "@/emails/ProposalEmail";
import { render } from "@react-email/render";
import { generateShareToken, buildPublicProposalUrl } from "@/lib/proposals/share-token";
import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { resolveSender } from "@/lib/proposals/senders";
import { generateProposalPdf } from "@/lib/proposals/pdf/generate";
import { uploadProposalPdf } from "@/lib/proposals/storage";
import { revalidatePath } from "next/cache";

interface SendProposalEmailInput {
  proposalId: string;
  to: string;
  subject?: string;
  message?: string;
  /** Which configured sender identity to send as (see getProposalSenders). */
  senderId?: string;
}

export async function sendProposalEmail(input: SendProposalEmailInput) {
  const user = await getUser();

  const proposal = await orm.crm_Proposals.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.createdBy !== user.id && !user.is_admin) {
    throw new Error("Forbidden");
  }

  // Ensure a share token exists — persisted BEFORE the send so the PDF render
  // (headless Chromium loading the public page) can resolve it.
  let token = proposal.shareToken as string | null;
  if (!token) {
    token = generateShareToken();
    await orm.crm_Proposals.update({
      where: { id: proposal.id },
      data: { shareToken: token },
    });
  }

  const url = buildPublicProposalUrl(proposal.number, proposal.clientSlug, token);

  // Attach the PDF twin of the designed proposal page. Chromium-printed from
  // the live public page; degrades to the plain @react-pdf doc if that fails.
  let pdfAttachment: { filename: string; content: Buffer }[] = [];
  let pdfEngine: string | null = null;
  try {
    const lineItems = await orm.crm_Proposal_LineItems.findMany({
      where: { proposalId: proposal.id },
      orderBy: { position: "asc" },
    });
    const settings = await orm.proposal_Settings.findFirst();
    const { pdf, engine } = await generateProposalPdf(
      { ...proposal, shareToken: token, lineItems: lineItems ?? [] },
      settings,
    );
    pdfEngine = engine;
    const numStr = String(proposal.number ?? "").padStart(4, "0");
    pdfAttachment = [{ filename: `Proposal-${numStr}-${proposal.clientSlug ?? "nuraview"}.pdf`, content: pdf }];
    // Best-effort cache so the CRM's PDF button serves the same file.
    try {
      const key = await uploadProposalPdf(proposal.id, pdf);
      await orm.crm_Proposals.update({
        where: { id: proposal.id },
        data: { pdfStorageKey: key, pdfGeneratedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[proposal send] pdf cache failed:", e);
    }
  } catch (e) {
    // Never block the send on PDF generation — send the link-only email.
    console.error("[proposal send] pdf generation failed:", e);
  }

  // Send as the chosen configured identity (Resend address or Mailu SMTP),
  // routed through the unified provider sender.
  const sender = resolveSender(input.senderId);
  const subject = input.subject ?? `Proposal: ${proposal.title}`;

  const html = await render(
    ProposalEmail({
      title: proposal.title,
      clientName: proposal.clientName,
      message: input.message,
      url,
      hasPdfAttachment: pdfAttachment.length > 0,
    }),
  );

  const res = await sendMarketingEmail({
    to: input.to,
    subject,
    html,
    from: sender.from,
    replyTo: sender.replyTo,
    provider: sender.provider,
    attachments: pdfAttachment,
  });
  if (res.error) {
    throw new Error(`Email failed via ${sender.provider} (${sender.from}): ${res.error}`);
  }

  const now = new Date().toISOString();
  const nextStatus = proposal.status === "DRAFT" ? "SENT" : proposal.status;

  await orm.crm_Proposals.update({
    where: { id: proposal.id },
    data: {
      shareToken: token,
      status: nextStatus,
      sentAt: proposal.sentAt ?? now,
      updatedAt: now,
    },
  });

  await orm.crm_Proposal_Activity.create({
    data: {
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      actorId: user.id,
      action: "SENT",
      meta: {
        to: input.to,
        subject,
        from: sender.from,
        provider: sender.provider,
        messageId: res.messageId ?? null,
        pdfAttached: pdfAttachment.length > 0,
        pdfEngine,
      },
      createdAt: now,
    },
  });

  revalidatePath(`/proposals/${proposal.id}`);
  return { success: true, url, pdfAttached: pdfAttachment.length > 0 };
}
