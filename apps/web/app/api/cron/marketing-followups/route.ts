// Safety-net sweeper for the Marketer follow-up queue.
//
// QStash schedules each follow-up as a one-off delayed job. If a job dies
// (domain change, account swap, deploy gap, 401/403 window), the item stays
// 'scheduled' forever and shows as "overdue" — with no self-healing. This cron
// closes that hole: every run it sends any follow-up that's >10 min overdue,
// independent of QStash. Idempotent (marks 'sent'; QStash handler skips sent
// items, and this skips them too), so it never double-sends.
//
// Scheduled from vercel.json: every 10 minutes.

import { NextRequest, NextResponse } from "next/server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "@/lib/marketing/email-signature";
import { sendTrackedFollowup } from "@/lib/marketing/followup-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron injects `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
  // is set; also accept the internal cron header and a ?secret= fallback.
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return true;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (new URL(req.url).searchParams.get("secret") === secret) return true;
  return false;
}

type Row = {
  id: number;
  sequence_id: number;
  contact_email: string;
  step_number: number;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  message_id_header: string | null;
  sender_id: string | null;
};

async function handler(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // >10 min overdue: gives QStash its normal on-time delivery first; this only
  // catches stragglers whose job never landed.
  const res = await db.execute(sql`
    SELECT i.id, i.sequence_id, i.contact_email, i.step_number,
           i.subject, i.body, i.body_html, i.message_id_header,
           s.sender_id
    FROM mkt_sequence_items i
    JOIN mkt_sequences s ON s.id = i.sequence_id
    LEFT JOIN mkt_sequence_exclusions e ON e.email = i.contact_email
    WHERE i.status = 'scheduled'
      AND s.status = 'active'
      AND e.id IS NULL
      AND i.scheduled_at <= now() - interval '10 minutes'
    ORDER BY i.scheduled_at
    LIMIT 50
  `);
  const rows = (res as unknown as { rows?: Row[] }).rows ?? [];

  let sent = 0;
  const errors: string[] = [];

  for (const item of rows) {
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

      // Tracked follow-up (creates a mkt_emails row → opens/clicks tracked +
      // counted) — always via Mailu SMTP (creative-hive).
      const r = await sendTrackedFollowup({
        to: item.contact_email,
        subject,
        bodyHtml,
        bodyText,
        headers: {
          "In-Reply-To": item.message_id_header || "",
          References: item.message_id_header || "",
          "X-Sequence-ID": String(item.sequence_id),
          "X-Sequence-Step": String(item.step_number),
          "X-Recovered-By": "cron",
        },
      });

      if (r.error) {
        errors.push(`#${item.id}: ${r.error}`);
        continue;
      }

      await db.execute(sql`
        UPDATE mkt_sequence_items
        SET status='sent', sent_at=now(), resend_id=${r.messageId || null}, updated_at=now()
        WHERE id=${item.id} AND status='scheduled'
      `);
      sent++;
    } catch (e) {
      errors.push(`#${item.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ swept: rows.length, sent, errors });
}

// VPS cron hits this (curl). Support GET + POST.
export const GET = handler;
export const POST = handler;
