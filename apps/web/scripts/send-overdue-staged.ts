// Staged recovery for a follow-up outage: for each active sequence, send only
// the EARLIEST overdue step now, and push every later overdue step forward
// (+12h spacing from now) by re-emitting a `marketing/followup` event to the
// self-hosted Inngest server — so recipients don't get two follow-ups in the
// same minute. Idempotent: only touches status='scheduled' rows.
//   INNGEST_EVENT_URL=http://185.245.182.175:8288/e/<EVENT_KEY> \
//   DATABASE_URL=postgres://... bun run scripts/send-overdue-staged.ts
//   DRY_RUN=1 to preview without sending/arming.

import { Pool } from "pg";
import { Resend } from "resend";
import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "../lib/marketing/email-signature";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "hello@hello.nuraview.com";
const REPLY_TO = process.env.RESEND_REPLY_TO || FROM_EMAIL;
const EVENT_URL =
  process.env.INNGEST_EVENT_URL || "http://127.0.0.1:8288/e/local";
const DRY = process.env.DRY_RUN === "1";
const SPACING_MS = 12 * 60 * 60 * 1000; // 12h between recovered steps

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
     ORDER BY i.contact_email, i.step_number, i.id`,
  );

  // group by recipient (not sequence) so a contact never gets two recovered
  // emails in the same minute, even across duplicate sequences
  const byEmail = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.contact_email.toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k)!.push(r);
  }

  const summary: string[] = [];
  for (const [, items] of Array.from(byEmail)) {
    const [first, ...later] = items;

    if (DRY) {
      summary.push(`#${first.id} WOULD-SEND step${first.step_number} -> ${first.contact_email}`);
    } else {
      try {
        const subject =
          first.step_number === 1
            ? first.subject || "Following up"
            : `Re: ${first.subject || "Following up"}`;
        let bodyHtml =
          first.body_html ||
          (first.body
            ? first.body.replace(/\n/g, "<br>")
            : "<p>Following up on my previous email.</p>");
        bodyHtml = `${bodyHtml}<br/><br/>${EMAIL_SIGNATURE_HTML}`;
        const bodyText = `${
          first.body || "Following up on my previous email."
        }\n\n${EMAIL_SIGNATURE_TEXT}`;

        const { data, error } = await resend.emails.send({
          from: `Varshith KM <${FROM_EMAIL}>`,
          to: [first.contact_email],
          replyTo: REPLY_TO,
          subject,
          html: bodyHtml,
          text: bodyText,
          headers: {
            ...(first.step_number > 1 && first.message_id_header
              ? {
                  "In-Reply-To": first.message_id_header,
                  References: first.message_id_header,
                }
              : {}),
            "X-Sequence-ID": String(first.sequence_id),
            "X-Sequence-Step": String(first.step_number),
          },
        });
        if (error) {
          summary.push(`#${first.id} ERROR ${first.contact_email}: ${error.message}`);
          continue; // don't re-arm later steps if the send failed
        }
        await pool.query(
          `UPDATE mkt_sequence_items
             SET status='sent', sent_at=now(), resend_id=$1, updated_at=now()
           WHERE id=$2 AND status='scheduled'`,
          [data?.id || null, first.id],
        );
        summary.push(`#${first.id} SENT step${first.step_number} -> ${first.contact_email}`);
      } catch (e) {
        summary.push(`#${first.id} EXCEPTION ${(e as Error).message}`);
        continue;
      }
    }

    for (let n = 0; n < later.length; n++) {
      const it = later[n];
      const fireAt = new Date(Date.now() + SPACING_MS * (n + 1));
      const delaySec = Math.round((fireAt.getTime() - Date.now()) / 1000);
      if (DRY) {
        summary.push(`#${it.id} WOULD-REARM step${it.step_number} +${delaySec}s ${it.contact_email}`);
        continue;
      }
      await pool.query(
        `UPDATE mkt_sequence_items
           SET scheduled_at=$1, updated_at=now()
         WHERE id=$2 AND status='scheduled'`,
        [fireAt.toISOString(), it.id],
      );
      const res = await fetch(EVENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "marketing/followup",
          data: {
            step: it.step_number,
            sequenceItemId: it.id,
            scheduledAt: fireAt.toISOString(),
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      summary.push(
        res.ok
          ? `#${it.id} REARMED step${it.step_number} +${Math.round(delaySec / 3600)}h ${it.contact_email} ids=${JSON.stringify(j.ids ?? j)}`
          : `#${it.id} REARM-FAIL ${res.status} ${JSON.stringify(j).slice(0, 100)}`,
      );
    }
  }
  await pool.end();

  console.log("\n=== Staged overdue recovery ===");
  for (const l of summary) console.log(l);
  const sent = summary.filter((l) => l.includes(" SENT ")).length;
  const armed = summary.filter((l) => l.includes(" REARMED ")).length;
  console.log(`\nSent now: ${sent}, re-armed for later: ${armed}, total overdue: ${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
