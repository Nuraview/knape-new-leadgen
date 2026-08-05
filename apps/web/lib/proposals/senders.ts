export interface ProposalSender {
  id: string;
  label: string;
  from: string; // full "Name <addr>" or bare address
  provider: "resend" | "smtp";
  replyTo?: string;
}

/**
 * Sender identity for proposals. Client mandate: send only as creative-hive
 * (Mailu SMTP). Resend removed.
 */
export function getProposalSenders(): ProposalSender[] {
  // Send as the person, not the brand (matches marketing SMTP_NAME).
  const name = process.env.MARKETING_FROM_NAME ?? "Varshith KM";
  const smtpFrom =
    process.env.MAILU_FROM_EMAIL || process.env.MAILU_SMTP_USER || "varshith@creative-hive.co";
  return [
    { id: `smtp:${smtpFrom}`, label: `${name} · ${smtpFrom}`, from: smtpFrom, provider: "smtp" },
  ];
}

export function resolveSender(senderId?: string | null): ProposalSender {
  const all = getProposalSenders();
  return all.find((s) => s.id === senderId) ?? all[0];
}
