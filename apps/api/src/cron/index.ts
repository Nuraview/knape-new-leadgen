/**
 * Scheduled jobs, called by the VPS crontab.
 *
 * Ported from apps/web/app/api/cron/**. Every route is gated by
 * requireCronSecret — see utils/cron-auth.ts for why this is NOT a copy of the
 * legacy check (the legacy one can be bypassed with a header).
 *
 * `/api/cron/reminders` is the live one: /usr/local/bin/nuraview-reminder-cron.sh
 * hits it every 10 minutes with `?secret=…` against a hard-coded crmx1 URL, so
 * the path and the query-param auth are both frozen.
 *
 * marketing-bounces / marketing-followups / proposal-expiry are declared here
 * but their bodies land with Phase F (marketing) and Phase E (proposals) — the
 * work they do lives in modules that have not been ported yet. They answer 501
 * rather than 200-with-nothing, so a scheduler pointed at them fails loudly
 * instead of silently reporting success while doing nothing.
 */
import { and, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import { crmLeads } from "../database/crm-schema";
import { SCHEDULED_JOBS, findScheduledJob } from "../scheduler/jobs";
import { requireCronSecret } from "../utils/cron-auth";
import { runLivenessChecks } from "./liveness";
import { normalizeJid } from "../whatsapp/jid";
import { buildReminderMessage } from "../whatsapp/template";

/** Reminders repeat every 2 hours until the recipient clicks the stop link. */
const REPEAT_DELAY_MS = 2 * 60 * 60 * 1000;

/**
 * Parses WHATSAPP_RECIPIENTS="VK:+919591194679,AbdulMateen:+919353087583"
 * into name → JID.
 */
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
      console.warn(
        `[reminders] invalid phone for recipient "${name}": ${phone}`,
      );
    }
  }

  return map;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * Resolve a lead's stored recipient name against the configured map.
 *
 * Three passes, mirroring the legacy behaviour exactly: exact key, then
 * case/whitespace-insensitive, then the Mazin/Mateen alias (the same person is
 * spelled both ways in stored data). Returns null when nothing matches so the
 * caller can fall back to WHATSAPP_TO rather than silently dropping.
 */
function resolveRecipientJid(
  recipientName: string | null,
  recipientMap: Map<string, string>,
): string | null {
  if (!recipientName) return null;

  const exact = recipientMap.get(recipientName);
  if (exact) return exact;

  const target = normalize(recipientName);
  for (const [name, jid] of recipientMap) {
    if (normalize(name) === target) return jid;
  }

  if (target.includes("mazin") || target.includes("mateen")) {
    for (const [name, jid] of recipientMap) {
      const n = normalize(name);
      if (n.includes("mazin") || n.includes("mateen")) return jid;
    }
  }

  return null;
}

const cron = new Hono();

cron.use("*", requireCronSecret);

/**
 * WhatsApp reminders are OFF by default as of 2026-07-28.
 *
 * Client decision in that day's call: "disable the WhatsApp, I don't think we
 * need WhatsApp reminders anymore. Just disable it for now." The trigger was
 * practical — his phone's back camera is broken, so he cannot rescan the
 * pairing QR, the bridge sits unlinked, and every reminder just queues up and
 * nags him about the disconnection.
 *
 * Implemented as a flag rather than deleting the route: "for now" was explicit,
 * and the cron, the recipient resolution and the message templates all still
 * work. Set WHATSAPP_REMINDERS_ENABLED=true to turn it back on.
 *
 * The endpoint still returns 200 with a reason, so the VPS crontab does not
 * start alerting on a job that is off on purpose.
 */
function remindersEnabled(): boolean {
  return process.env.WHATSAPP_REMINDERS_ENABLED === "true";
}

cron.get("/reminders", async (c) => {
  if (!remindersEnabled()) {
    return c.json({
      processed: 0,
      results: [],
      skipped: "WhatsApp reminders are disabled (WHATSAPP_REMINDERS_ENABLED)",
    });
  }

  // Fallback recipient when the lead has no reminderAccount set.
  let fallbackJid: string | null = null;
  const rawFallback = process.env.WHATSAPP_TO;
  if (rawFallback) {
    try {
      fallbackJid = normalizeJid(rawFallback);
    } catch (e) {
      return c.json(
        { error: `Invalid WHATSAPP_TO: ${(e as Error).message}` },
        500,
      );
    }
  }

  const recipientMap = buildRecipientMap();
  const now = new Date();

  const due = await crmDb
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
        lte(crmLeads.reminderAt, now),
      ),
    )
    .limit(50);

  // The lead-card and stop links embedded in the message. NEXT_PUBLIC_APP_URL
  // is the legacy name; APP_URL is the one this stack sets. Either works, so a
  // half-migrated .env still produces clickable links.
  const baseUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  const results: Array<{
    id: string;
    enqueued: boolean;
    kind?: "first" | "repeat";
    recipient?: string;
    reason?: string;
  }> = [];

  for (const lead of due) {
    const isRepeat = lead.reminderFollowupPending === true;
    const recipientName = lead.reminderAccount?.trim() || null;

    let toJid = resolveRecipientJid(recipientName, recipientMap);
    if (recipientName && !toJid) {
      // Stored but not in the current env — warn and fall back rather than
      // silently dropping the reminder.
      console.warn(
        `[reminders] lead ${lead.id}: recipient "${recipientName}" not in WHATSAPP_RECIPIENTS`,
      );
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

    const message = buildReminderMessage(
      {
        id: lead.id,
        firstName: lead.firstName,
        jobTitle: lead.jobTitle,
        company: lead.company,
        phone: lead.phone,
        email: lead.email,
        lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
        reminderNote: lead.reminderNote,
        upworkJobUrl: lead.upworkJobUrl,
      },
      baseUrl,
      recipientName,
    );
    const finalMessage = isRepeat ? `🔁 Follow-up\n${message}` : message;
    const nextFireAt = new Date(now.getTime() + REPEAT_DELAY_MS).toISOString();

    try {
      await crmDb.execute(sql`
        INSERT INTO whatsapp_outbox (to_jid, body, lead_id, enqueued_by)
        VALUES (${toJid}, ${finalMessage}, ${lead.id}, 'reminder-cron')
      `);

      // reminder_first_sent_at anchors the 24h "stay in the Reminders column"
      // behaviour, so it is only stamped on the FIRST send of a cycle.
      if (isRepeat) {
        await crmDb.execute(sql`
          UPDATE "crm_Leads"
             SET "reminder_sent_at" = now(),
                 "reminder_at" = ${nextFireAt}::timestamp,
                 "reminder_followup_pending" = true
           WHERE "id" = ${lead.id}
        `);
      } else {
        await crmDb.execute(sql`
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

  return c.json({ processed: due.length, results });
});

/**
 * Not yet ported — the modules these drive land in Phase E/F.
 *
 * 501 rather than a cheerful 200: a scheduler pointed here should fail visibly
 * instead of logging success while nothing happens.
 */
const notYetPorted = (module: string) => (c: import("hono").Context) =>
  c.json(
    {
      error: "not_implemented",
      message: `${module} has not been ported to this stack yet; it still runs on the legacy app.`,
    },
    501,
  );

cron.get("/marketing-bounces", notYetPorted("marketing bounce polling"));
// Same dispatcher the in-app scheduler runs every 5 minutes; this route lets
// the VPS crontab act as an external backstop. Both paths are idempotent —
// a step already marked sent is skipped.
cron.get("/marketing-followups", async (c) => {
  const { processMarketingFollowups } = await import(
    "../scheduler/marketing-followups"
  );
  await processMarketingFollowups();
  return c.json({ ok: true });
});
cron.get("/proposal-expiry", notYetPorted("proposal expiry"));

/**
 * Is the machinery actually running? See cron/liveness.ts for the why.
 *
 * Answers 200 when every assertion passes and 503 when any fails, so a plain
 * `curl -f` is a sufficient alarm and the cron script needs no JSON parsing.
 */
cron.get("/liveness", async (c) => {
  const report = await runLivenessChecks();
  return c.json(report, report.ok ? 200 : 503);
});

/**
 * HTTP driver for the in-process scheduler.
 *
 * On the VPS the eight jobs in scheduler/jobs.ts run inside the API process
 * under croner. On Vercel there is no process to hold a timer, so each job gets
 * a Vercel Cron entry pointing here at the SAME cadence the registry declares —
 * see vercel.json. Both runners read scheduler/jobs.ts, so a retuned interval
 * cannot end up applied on one deployment and not the other.
 *
 * An unknown :name answers 404 rather than 200. A cron entry pointing at a
 * renamed job must fail visibly in the Vercel log, not quietly report success
 * while running nothing — which is exactly how the marketing follow-up queue
 * sat unprocessed for 45 days.
 *
 * Errors are NOT swallowed here, unlike croner's guarded() wrapper: a function
 * invocation that fails should surface as a failed cron run in the dashboard.
 * There is no shared process left to protect.
 */
cron.get("/scheduled/:name", async (c) => {
  const name = c.req.param("name");
  const job = findScheduledJob(name);

  if (!job) {
    return c.json(
      {
        error: `Unknown scheduled job "${name}"`,
        known: SCHEDULED_JOBS.map((j) => j.name),
      },
      404,
    );
  }

  const startedAt = Date.now();
  await job.run();

  return c.json({
    ok: true,
    job: job.name,
    schedule: job.schedule,
    durationMs: Date.now() - startedAt,
  });
});

export default cron;
