import type Imap from "imap";
import { simpleParser } from "mailparser";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { connectImap, type ImapAccount } from "@/inngest/lib/imap-utils";
import { db } from "@/lib/db";
import {
  mktEmails as emails,
  mktUsers as users,
  mktSequenceExclusions as exclusions,
} from "@/lib/db";

function imapAccount(): ImapAccount {
  return {
    username: process.env.MAILU_IMAP_USER || process.env.MAILU_SMTP_USER || "",
    password: process.env.MAILU_IMAP_PASSWORD || process.env.MAILU_SMTP_PASSWORD || "",
    imapHost: process.env.MAILU_IMAP_HOST || "mail.tec5usa.us",
    imapPort: parseInt(process.env.MAILU_IMAP_PORT || "993", 10),
    imapSsl: process.env.MAILU_IMAP_SSL ? process.env.MAILU_IMAP_SSL === "true" : true,
  };
}

export function isImapConfigured(): boolean {
  const a = imapAccount();
  return !!(a.username && a.password && a.imapHost);
}

/** Fetch UNSEEN messages (raw + uid) WITHOUT marking them read. */
function fetchUnseen(imap: Imap): Promise<{ uid: number; raw: string }[]> {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", false, (err) => {
      if (err) return reject(err);
      imap.search(["UNSEEN"], (e, uids) => {
        if (e) return reject(e);
        if (!uids?.length) return resolve([]);
        const recent = uids.slice(-200); // cap work per run
        const out: { uid: number; raw: string }[] = [];
        const f = imap.fetch(recent, { bodies: "", markSeen: false });
        f.on("message", (msg) => {
          let buf = "";
          let uid = 0;
          msg.on("body", (stream) => {
            stream.on("data", (d: Buffer) => (buf += d.toString("utf8")));
          });
          msg.once("attributes", (attrs) => (uid = attrs.uid));
          msg.once("end", () => out.push({ uid, raw: buf }));
        });
        f.once("error", reject);
        f.once("end", () => resolve(out));
      });
    });
  });
}

function markSeen(imap: Imap, uid: number): Promise<void> {
  return new Promise((resolve) => {
    imap.addFlags(uid, ["\\Seen"], () => resolve());
  });
}

function isBounce(headers: string, fromAddr: string, subject: string): boolean {
  const f = fromAddr.toLowerCase();
  if (/mailer-daemon|postmaster/.test(f)) return true;
  if (/multipart\/report|report-type=["']?delivery-status/i.test(headers)) return true;
  if (/auto-submitted:\s*auto-replied/i.test(headers)) return true;
  if (/Final-Recipient:/i.test(headers) && /Status:\s*5\./i.test(headers)) return true;
  if (/undeliverable|delivery (status|has failed)|delivery failed|returned mail|mail delivery failed|failure notice/i.test(subject)) return true;
  return false;
}

// A reply is an unsubscribe request when the recipient's own mail client sends
// us mail whose subject/body says "unsubscribe" (our footer mailto pre-fills
// exactly that). Guard against system mail so a bounce/auto-reply is never
// mistaken for an opt-out.
function isUnsubscribe(subject: string, text: string, fromAddr: string): boolean {
  const from = (fromAddr || "").toLowerCase();
  if (/mailer-daemon|postmaster|no-?reply|do-?not-?reply/.test(from)) return false;
  const s = (subject || "").toLowerCase();
  if (/\bunsubscribe\b|\bunsub\b|\bopt[\s-]?out\b|\bremove me\b/.test(s)) return true;
  const b = (text || "").slice(0, 800).toLowerCase();
  return /\bunsubscribe\b|\bopt[\s-]?out\b/.test(b);
}

function failedRecipient(raw: string): string | null {
  const m = raw.match(/Final-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>]+@[^\s<>]+)>?/i)
    || raw.match(/Original-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>]+@[^\s<>]+)>?/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function messageIds(raw: string): string[] {
  const ids = new Set<string>();
  const re = /Message-ID:\s*<([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) ids.add(m[1].trim());
  return Array.from(ids);
}

/**
 * Poll the creative-hive mailbox for bounce (DSN) messages, mark the matching
 * mkt_emails as bounced, and exclude the address from future follow-ups.
 * Idempotent; only flags bounce messages \Seen (leaves real replies untouched).
 */
export async function pollBounces(): Promise<{ scanned: number; bounced: number; matched: number; unsubscribed: number }> {
  if (!isImapConfigured()) return { scanned: 0, bounced: 0, matched: 0, unsubscribed: 0 };

  const imap = await connectImap(imapAccount());
  let msgs: { uid: number; raw: string }[] = [];
  try {
    msgs = await fetchUnseen(imap);

    let bounced = 0;
    let matched = 0;
    let unsubscribed = 0;
    for (const { uid, raw } of msgs) {
      const parsed = await simpleParser(raw);
      const headerBlock = raw.slice(0, 8000);
      const fromAddr = parsed.from?.value?.[0]?.address ?? "";
      const subject = parsed.subject ?? "";
      if (!isBounce(headerBlock + "\n" + raw, fromAddr, subject)) {
        // Not a bounce — is it an unsubscribe request from the recipient?
        if (isUnsubscribe(subject, parsed.text ?? "", fromAddr)) {
          const email = fromAddr.trim().toLowerCase();
          if (email) {
            await markSeen(imap, uid); // handled → don't reprocess
            const [ex] = await db
              .select()
              .from(exclusions)
              .where(eq(exclusions.email, email))
              .limit(1);
            if (!ex) {
              await db
                .insert(exclusions)
                .values({ email, reason: "unsubscribe" })
                .catch(() => {});
              unsubscribed++;
            } else if (ex.reason !== "unsubscribe") {
              // Upgrade a prior bounce-origin exclusion to a real opt-out so it
              // surfaces on the dashboard's Unsubscribed list.
              await db
                .update(exclusions)
                .set({ reason: "unsubscribe" })
                .where(eq(exclusions.id, ex.id));
              unsubscribed++;
            }
          }
        }
        // A plain reply (not a bounce, not an unsubscribe) is left UNSEEN.
        continue;
      }
      bounced++;
      await markSeen(imap, uid); // it's a bounce → mark read so we don't reprocess

      const rcpt = failedRecipient(raw);
      const ids = messageIds(raw);

      let row: { id: number; bouncedAt: Date | null } | undefined;
      if (ids.length) {
        const cands = ids.flatMap((id) => [id, `<${id}>`]);
        [row] = await db
          .select({ id: emails.id, bouncedAt: emails.bouncedAt })
          .from(emails)
          .where(inArray(emails.providerMessageId, cands))
          .limit(1);
      }
      if (!row && rcpt) {
        const [u] = await db.select().from(users).where(eq(users.email, rcpt)).limit(1);
        if (u) {
          [row] = await db
            .select({ id: emails.id, bouncedAt: emails.bouncedAt })
            .from(emails)
            .where(and(eq(emails.recipientId, u.id), isNotNull(emails.providerMessageId)))
            .orderBy(desc(emails.sentDate))
            .limit(1);
        }
      }

      if (row && !row.bouncedAt) {
        await db
          .update(emails)
          .set({ status: "bounced", bouncedAt: new Date() })
          .where(eq(emails.id, row.id));
        matched++;
        if (rcpt) {
          const [ex] = await db.select().from(exclusions).where(eq(exclusions.email, rcpt)).limit(1);
          if (!ex) await db.insert(exclusions).values({ email: rcpt }).catch(() => {});
        }
      }
    }
    return { scanned: msgs.length, bounced, matched, unsubscribed };
  } finally {
    try {
      imap.end();
    } catch {}
  }
}
