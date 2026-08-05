import { getSendingAccounts } from "./sending-accounts";

export interface EmailSender {
  id: string;
  label: string;
  from: string;
  provider: "resend" | "smtp";
  replyTo?: string;
}

/**
 * Public "from" identities for the compose pickers (kanban + marketing). Derived
 * from the sending-accounts registry but STRIPPED of SMTP creds — safe to return
 * to the browser via /api/marketing/senders. The picker posts the chosen `id`
 * back; `resolveSendingAccount(id)` (server-only) maps it to real creds at send.
 */
export function getEmailSenders(): EmailSender[] {
  return getSendingAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    from: `${a.fromName} <${a.fromEmail}>`,
    provider: "smtp",
    replyTo: a.replyTo ?? a.fromEmail,
  }));
}

/** Resolve a sender id to its public config. "auto"/missing → undefined. */
export function resolveEmailSender(id?: string | null): EmailSender | undefined {
  if (!id || id === "auto") return undefined;
  return getEmailSenders().find((s) => s.id === id);
}
