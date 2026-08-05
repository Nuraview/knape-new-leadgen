// Sends every overdue follow-up step the broken QStash jobs never delivered:
// active CRM-owned sequences (item id >= 871), status='scheduled',
// scheduled_at <= now. Replicates the queue/followup handler. Idempotent:
// marks each 'sent' so it can't double, and skips anything already sent.
// Set SKIP_TEST=1 to skip afhamabid1@gmail.com (#876).
//   cd apps/web && bun run scripts/send-overdue.ts

import { Pool } from "pg";
import { Resend } from "resend";
import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "../lib/marketing/email-signature";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "hello@hello.nuraview.com";
const REPLY_TO = process.env.RESEND_REPLY_TO || FROM_EMAIL;
const SKIP_TEST = process.env.SKIP_TEST === "1";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED!,
    ssl: { rejectUnauthorized: false },
  });
  const resend = new Resend(process.env.RESEND_API_KEY!);

  const { rows } = await pool.query(
    `SELECT i.id, i.sequence_id, i.contact_email, i.step_number, i.subject,
            i.body, i.body_html, i.message_id_header
     FROM mkt_sequence_items i JOIN mkt_sequences s ON s.id = i.sequence_id
     WHERE s.status='active' AND i.status='scheduled'
       AND i.scheduled_at <= now() AND i.id >= 871
     ORDER BY i.id`,
  );

  const summary: string[] = [];
  for (const item of rows) {
    if (SKIP_TEST && item.contact_email === "afhamabid1@gmail.com") {
      summary.push(`#${item.id} SKIP test`);
      continue;
    }
    try {
      const subject = `Re: ${item.subject || "Following up"}`;
      let bodyHtml =
        item.body_html ||
        (item.body
          ? item.body.replace(/\n/g, "<br>")
          : "<p>Following up on my previous email.</p>");
      bodyHtml = `${bodyHtml}<br/><br/>${EMAIL_SIGNATURE_HTML}`;
      const bodyText = `${
        item.body || "Following up on my previous email."
      }\n\n${EMAIL_SIGNATURE_TEXT}`;

      const { data, error } = await resend.emails.send({
        from: `Varshith KM <${FROM_EMAIL}>`,
        to: [item.contact_email],
        replyTo: REPLY_TO,
        subject,
        html: bodyHtml,
        text: bodyText,
        headers: {
          "In-Reply-To": item.message_id_header || "",
          References: item.message_id_header || "",
          "X-Sequence-ID": String(item.sequence_id),
          "X-Sequence-Step": String(item.step_number),
        },
      });
      if (error) {
        summary.push(`#${item.id} ERROR ${item.contact_email}: ${error.message}`);
        continue;
      }
      await pool.query(
        `UPDATE mkt_sequence_items
           SET status='sent', sent_at=now(), resend_id=$1, updated_at=now()
         WHERE id=$2`,
        [data?.id || null, item.id],
      );
      summary.push(
        `#${item.id} SENT step${item.step_number} -> ${item.contact_email}`,
      );
    } catch (e) {
      summary.push(`#${item.id} EXCEPTION ${(e as Error).message}`);
    }
  }
  await pool.end();
  console.log("\n=== Overdue follow-up recovery ===");
  for (const l of summary) console.log(l);
  console.log(`\nSent ${summary.filter((l) => l.includes(" SENT ")).length}/${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
