// One-off recovery: send the follow-up steps that QStash queued but couldn't
// deliver (they 401'd at the middleware before the prod fix shipped). We
// replicate the /api/marketing/queue/followup handler exactly, but invoke it
// directly here — no QStash, no middleware, no deploy required.
//
// Scope: the EXACT sequence_item ids that failed into the QStash DLQ. These are
// all CRM-created (id >= 872; migrated rows are id <= 870), so there is no
// overlap with the migrated sequences the old app still owns. Idempotent: skips
// anything already 'sent' or whose sequence isn't active.
//
//   cd apps/web && bun run scripts/trigger-failed-followups.ts

import { Pool } from "pg";
import { Resend } from "resend";

import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "../lib/marketing/email-signature";

// The 16 failed step-1 follow-ups, straight from the QStash DLQ payloads.
const FAILED_ITEM_IDS = [
  872, 875, 878, 881, 884, 887, 890, 893, 896, 899, 902, 905, 908, 911, 914,
  917,
];

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "hello@hello.nuraview.com";
const REPLY_TO = process.env.RESEND_REPLY_TO || FROM_EMAIL;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const pool = new Pool({
  connectionString: required("DATABASE_URL_UNPOOLED"),
  ssl: { rejectUnauthorized: false },
});
const resend = new Resend(required("RESEND_API_KEY"));

type Row = {
  id: number;
  sequence_id: number;
  contact_email: string;
  step_number: number;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  status: string;
  message_id_header: string | null;
  seq_status: string;
};

const summary: string[] = [];

for (const id of FAILED_ITEM_IDS) {
  try {
    const { rows } = await pool.query<Row>(
      `SELECT i.id, i.sequence_id, i.contact_email, i.step_number, i.subject,
              i.body, i.body_html, i.status, i.message_id_header,
              s.status AS seq_status
       FROM mkt_sequence_items i
       JOIN mkt_sequences s ON s.id = i.sequence_id
       WHERE i.id = $1`,
      [id],
    );
    const item = rows[0];
    if (!item) {
      summary.push(`#${id} SKIP not found`);
      continue;
    }
    if (item.seq_status !== "active") {
      summary.push(`#${id} SKIP sequence ${item.seq_status}`);
      continue;
    }
    if (item.status === "sent") {
      summary.push(`#${id} SKIP already sent (${item.contact_email})`);
      continue;
    }

    const excl = await pool.query(
      `SELECT 1 FROM mkt_sequence_exclusions WHERE email = $1 LIMIT 1`,
      [item.contact_email],
    );
    if ((excl.rowCount ?? 0) > 0) {
      summary.push(`#${id} SKIP excluded (${item.contact_email})`);
      continue;
    }

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
      summary.push(`#${id} ERROR ${item.contact_email}: ${error.message}`);
      continue;
    }

    await pool.query(
      `UPDATE mkt_sequence_items
         SET status='sent', sent_at=now(), resend_id=$1, updated_at=now()
       WHERE id=$2`,
      [data?.id || null, id],
    );
    summary.push(
      `#${id} SENT -> ${item.contact_email} (resend ${data?.id?.slice(0, 8)})`,
    );
  } catch (e) {
    summary.push(`#${id} EXCEPTION ${(e as Error).message}`);
  }
}

await pool.end();

console.log("\n=== Follow-up recovery summary ===");
for (const line of summary) console.log(line);
const sent = summary.filter((l) => l.includes(" SENT ")).length;
console.log(`\nSent ${sent}/${FAILED_ITEM_IDS.length}`);
