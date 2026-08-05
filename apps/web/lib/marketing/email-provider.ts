import nodemailer, { type Transporter } from "nodemailer";
import {
  getDefaultSendingAccount,
  resolveSendingAccount,
  type SendingAccount,
} from "@/lib/marketing/sending-accounts";

// Outbound email goes through per-domain SMTP (Mailu for creative-hive.co,
// mail.tec5usa.us for nuraview.us). The caller picks the identity by passing
// `accountId` (an email-senders id); missing → the default (creative-hive).
// Resend is no longer used for sending anywhere in the CRM.
export type EmailProvider = "resend" | "smtp";

// One cached transport per sending account (keyed by account id) — each domain
// has its own SMTP server, so a single shared singleton can't serve both.
const _transports = new Map<string, Transporter>();

function getTransportFor(account: SendingAccount): Transporter {
  if (!account.smtp.host || !account.smtp.user || !account.smtp.pass) {
    throw new Error(
      `SMTP not configured for sending account "${account.id}" (missing host/user/password env)`,
    );
  }
  let t = _transports.get(account.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.smtp.user, pass: account.smtp.pass },
    });
    _transports.set(account.id, t);
  }
  return t;
}

export function isSmtpConfigured(): boolean {
  const a = getDefaultSendingAccount();
  return !!(a.smtp.host && a.smtp.user && a.smtp.pass);
}

// Back-compat exports: the default (creative-hive) from address/name. Callers
// that don't pass an accountId still send as this identity.
const _default = getDefaultSendingAccount();
export const SMTP_FROM = `${_default.fromName} <${_default.fromEmail}>`;

/** Provider selection is fixed to SMTP per client mandate. */
export function chooseProvider(): EmailProvider {
  return "smtp";
}

export interface SendArgs {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Sending identity id (email-senders id). Missing → default (creative-hive). */
  accountId?: string | null;
  /** @deprecated Superseded by `accountId`. Ignored — kept for call-site compat. */
  from?: string;
  headers?: Record<string, string>;
  provider?: EmailProvider;
  attachments?: { filename: string; content: Buffer | string }[];
}

export interface SendResult {
  provider: EmailProvider;
  messageId: string | null;
  /** true = the mail server accepted the message for delivery (info.accepted). */
  accepted: boolean;
  /** The identity the message was actually sent as ("Name <email>"). */
  sentAs?: string;
  error?: string;
}

/**
 * Unified outbound send. Routes through the SMTP server of the selected sending
 * account (`args.accountId`), falling back to the default (creative-hive) when
 * none/unknown is given. The From/Reply-To are taken from the resolved account,
 * so a picked domain actually sends as that domain.
 */
export async function sendMarketingEmail(args: SendArgs): Promise<SendResult> {
  const account = resolveSendingAccount(args.accountId) ?? getDefaultSendingAccount();
  const from = `${account.fromName} <${account.fromEmail}>`;
  const toArr = Array.isArray(args.to) ? args.to : [args.to];
  try {
    const info = await getTransportFor(account).sendMail({
      from,
      to: toArr,
      cc: args.cc,
      bcc: args.bcc,
      replyTo: args.replyTo ?? account.replyTo ?? account.fromEmail,
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers: args.headers,
      attachments: args.attachments,
    });
    const accepted =
      Array.isArray(info.accepted) &&
      info.accepted.length > 0 &&
      (!Array.isArray(info.rejected) || info.rejected.length === 0);
    return {
      provider: "smtp",
      messageId: info.messageId ?? null,
      accepted,
      sentAs: from,
    };
  } catch (e) {
    return {
      provider: "smtp",
      messageId: null,
      accepted: false,
      sentAs: from,
      error: e instanceof Error ? e.message : "SMTP send failed",
    };
  }
}
