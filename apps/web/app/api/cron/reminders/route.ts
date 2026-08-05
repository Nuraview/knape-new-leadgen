import { NextRequest, NextResponse } from "next/server";

import { and, isNotNull, isNull, lte, sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db";
import { crmLeads } from "@/drizzle/schema";
import { buildReminderMessage } from "@/lib/whatsapp/template";
import { normalizeJid } from "@/lib/whatsapp/jid";

// Reminders repeat every 2 hours until the recipient clicks the stop link.
const REPEAT_DELAY_MS = 2 * 60 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parses WHATSAPP_RECIPIENTS="VK:+919591194679,AbdulMateen:+919353087583"
// into a map of name → phone JID.
function buildRecipientMap(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.WHATSAPP_RECIPIENTS ?? "";
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const phone = part.slice(idx + 1).trim();
    if (!name || !phone) continue;
    try {
      map.set(name, normalizeJid(phone));
    } catch {
      console.warn(`[reminders] invalid phone for recipient "${name}": ${phone}`);
    }
  }
  return map;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const headerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const queryToken = req.nextUrl.searchParams.get("secret") ?? "";
  if (headerToken !== expected && queryToken !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fallback recipient when the lead has no reminderAccount set.
  let fallbackJid: string | null = null;
  const rawFallback = process.env.WHATSAPP_TO;
  if (rawFallback) {
    try {
      fallbackJid = normalizeJid(rawFallback);
    } catch (e) {
      return NextResponse.json(
        { error: `Invalid WHATSAPP_TO: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  const recipientMap = buildRecipientMap();

  const now = new Date();
  const due = await db
    .select({
      id: crmLeads.id,
      company: crmLeads.company,
      firstName: crmLeads.firstName,
      jobTitle: crmLeads.jobTitle,
      phone: crmLeads.phone,
      email: crmLeads.email,
      upworkJobUrl: crmLeads.upworkJobUrl,
      lastContactedAt: crmLeads.lastContactedAt,
      reminderNote: crmLeads.reminderNote,
      reminderFollowupPending: crmLeads.reminderFollowupPending,
      reminderAccount: crmLeads.reminderAccount,
    })
    .from(crmLeads)
    .where(
      and(
        isNotNull(crmLeads.reminderAt),
        isNull(crmLeads.deletedAt),
        lte(crmLeads.reminderAt, now.toISOString()),
      ),
    )
    .limit(50);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const results: Array<{
    id: string;
    enqueued: boolean;
    kind?: "first" | "repeat";
    recipient?: string;
    reason?: string;
  }> = [];

  for (const lead of due) {
    const isRepeat = lead.reminderFollowupPending === true;

    // Resolve recipient: named recipient from WHATSAPP_RECIPIENTS → WHATSAPP_TO fallback.
    const recipientName = lead.reminderAccount?.trim() ?? null;
    let toJid: string | null = null;
    if (recipientName) {
      toJid = recipientMap.get(recipientName) ?? null;
      if (!toJid) {
        // Try normalized match (case-insensitive, ignore whitespace)
        const normSearch = recipientName.toLowerCase().replace(/\s+/g, "");
        for (const [name, jid] of recipientMap.entries()) {
          const normName = name.toLowerCase().replace(/\s+/g, "");
          if (normName === normSearch) {
            toJid = jid;
            break;
          }
        }
      }
      
      // Fallback/alias: if still not found and searching for Mazin/Mateen, try mapping them
      if (!toJid) {
        const normSearch = recipientName.toLowerCase().replace(/\s+/g, "");
        if (normSearch.includes("mazin") || normSearch.includes("mateen")) {
          for (const [name, jid] of recipientMap.entries()) {
            const normName = name.toLowerCase().replace(/\s+/g, "");
            if (normName.includes("mazin") || normName.includes("mateen")) {
              toJid = jid;
              break;
            }
          }
        }
      }

      if (!toJid) {
        // Name was stored but not found in current env — try fallback rather
        // than silently dropping, but warn in the response.
        console.warn(
          `[reminders] lead ${lead.id}: recipient "${recipientName}" not in WHATSAPP_RECIPIENTS`,
        );
      }
    }
    toJid = toJid ?? fallbackJid;

    if (!toJid) {
      results.push({
        id: lead.id,
        enqueued: false,
        reason: `no recipient (reminderAccount="${recipientName ?? ""}", WHATSAPP_RECIPIENTS not configured or matched, and no WHATSAPP_TO fallback)`,
      });
      continue;
    }

    const message = buildReminderMessage(lead, baseUrl, recipientName);
    const finalMessage = isRepeat ? `🔁 Follow-up\n${message}` : message;
    const nextFireAt = new Date(now.getTime() + REPEAT_DELAY_MS).toISOString();

    try {
      await db.execute(dsql`
        INSERT INTO whatsapp_outbox (to_jid, body, lead_id, enqueued_by)
        VALUES (${toJid}, ${finalMessage}, ${lead.id}, 'reminder-cron')
      `);

      if (isRepeat) {
        await db.execute(dsql`
          UPDATE "crm_Leads"
             SET "reminder_sent_at" = now(),
                 "reminder_at" = ${nextFireAt}::timestamp,
                 "reminder_followup_pending" = true
           WHERE "id" = ${lead.id}
        `);
      } else {
        await db.execute(dsql`
          UPDATE "crm_Leads"
             SET "reminder_sent_at" = now(),
                 "reminder_first_sent_at" = now(),
                 "reminder_at" = ${nextFireAt}::timestamp,
                 "reminder_followup_pending" = true
           WHERE "id" = ${lead.id}
        `);
      }

      results.push({
        id: lead.id,
        enqueued: true,
        kind: isRepeat ? "repeat" : "first",
        recipient: recipientName ?? "(fallback)",
      });
    } catch (e) {
      results.push({
        id: lead.id,
        enqueued: false,
        reason: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ processed: due.length, results });
}
