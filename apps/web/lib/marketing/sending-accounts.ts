import "server-only";

// Outbound sending identities the CRM can send *as*. Each carries its own SMTP
// connection so different domains route through different servers:
//  - creative-hive.co  → Mailu VPS      (MAILU_SMTP_*)
//  - nuraview.us        → mail.tec5usa.us (NURAVIEW_SMTP_*)
//
// This is the ONLY module that holds SMTP passwords. Never return a
// SendingAccount to the browser — expose the public shape via
// `email-senders.ts#getEmailSenders()` (id/label/from only).
export interface SendingAccount {
  /** Stable id used by the UI picker + persisted on sequences ("smtp:<email>"). */
  id: string;
  /** Human label for the picker. */
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
}

function senderName(): string {
  // Send as the person, not the brand — see email-provider.ts SMTP_NAME.
  return process.env.MARKETING_FROM_NAME || "Varshith KM";
}

// Build one account from a prefixed env group (MAILU_ / NURAVIEW_). Returns null
// when the group isn't fully configured, so half-set domains never surface as a
// broken picker option.
function accountFromEnv(
  prefix: string,
  fallbackEmail: string,
): SendingAccount | null {
  const host = process.env[`${prefix}_SMTP_HOST`];
  const user = process.env[`${prefix}_SMTP_USER`];
  const pass = process.env[`${prefix}_SMTP_PASSWORD`];
  if (!host || !user || !pass) return null;

  const email = process.env[`${prefix}_FROM_EMAIL`] || user || fallbackEmail;
  const port = parseInt(process.env[`${prefix}_SMTP_PORT`] || "465", 10);
  const secureEnv = process.env[`${prefix}_SMTP_SECURE`];
  const name = senderName();

  return {
    id: `smtp:${email}`,
    label: `${name} · ${email}`,
    fromName: name,
    fromEmail: email,
    smtp: {
      host,
      port,
      secure: secureEnv ? secureEnv === "true" : port === 465,
      user,
      pass,
    },
  };
}

/**
 * Every "from" identity available for outbound sending. First entry is the
 * default. creative-hive (Mailu) stays first/default; nuraview.us appears when
 * its NURAVIEW_SMTP_* env is set.
 */
export function getSendingAccounts(): SendingAccount[] {
  const accounts: SendingAccount[] = [];

  const creativeHive = accountFromEnv("MAILU", "varshith@creative-hive.co");
  if (creativeHive) accounts.push(creativeHive);

  const nuraview = accountFromEnv("NURAVIEW", "varshith@nuraview.us");
  if (nuraview) accounts.push(nuraview);

  // Dev/safety fallback: if MAILU env is absent the send would throw anyway, but
  // keep a default entry so the picker + `getDefaultSendingAccount()` never
  // return undefined and the app renders.
  if (accounts.length === 0) {
    const name = senderName();
    accounts.push({
      id: "smtp:varshith@creative-hive.co",
      label: `${name} · varshith@creative-hive.co`,
      fromName: name,
      fromEmail: "varshith@creative-hive.co",
      smtp: {
        host: process.env.MAILU_SMTP_HOST || "",
        port: parseInt(process.env.MAILU_SMTP_PORT || "465", 10),
        secure: true,
        user: process.env.MAILU_SMTP_USER || "",
        pass: process.env.MAILU_SMTP_PASSWORD || "",
      },
    });
  }

  return accounts;
}

/** The default sending identity (creative-hive). Never undefined. */
export function getDefaultSendingAccount(): SendingAccount {
  return getSendingAccounts()[0];
}

/**
 * Resolve a picker id to its full account (with SMTP creds). "auto"/missing →
 * undefined so callers fall back to the default.
 */
export function resolveSendingAccount(
  id?: string | null,
): SendingAccount | undefined {
  if (!id || id === "auto") return undefined;
  return getSendingAccounts().find((a) => a.id === id);
}

/**
 * The id of the account a send will ACTUALLY use — the resolved account, or the
 * default when none/unknown is given. Store this on each mkt_emails row so
 * per-domain deliverability never has a null/"unknown" bucket.
 */
export function resolveSendingAccountId(id?: string | null): string {
  return (resolveSendingAccount(id) ?? getDefaultSendingAccount()).id;
}

/** Human label for an account id — falls back to the bare address / the id. */
export function sendingAccountLabel(id: string): string {
  const a = getSendingAccounts().find((x) => x.id === id);
  return a?.label ?? id.replace(/^smtp:/, "");
}
