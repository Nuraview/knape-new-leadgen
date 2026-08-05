/**
 * Marketing mailbox — the cold-email side of the product.
 *
 * Ported from apps/web/lib/marketing/queries.ts and app/api/marketing/**.
 *
 * SCOPE: reading. Dashboard counters, thread list, thread detail, contacts,
 * sequences and templates. SENDING is not here — compose, the follow-up
 * scheduler and bounce polling stay on the legacy app until Inngest and the
 * IMAP sidecar land, because a half-migrated sender is the one failure that
 * emails real prospects from the wrong place or silently drops a follow-up
 * mid-sequence.
 *
 * `/api/marketing/track/{open,click}` is deliberately NOT here either. Those
 * URLs are baked into email already delivered to inboxes; they move once, at
 * cutover, and must keep their exact paths forever.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSendingAccounts } from "./lib/sending-accounts";
import { validateEmail } from "./lib/email-validator";
import send from "./send";
import { put } from "../storage/objects";
import {
  extractCapVideoId,
  renderVideoCardHtml,
  resolveCapEmbed,
} from "../videos/cap-embed";
import crmDb from "../database/crm";
import {
  mktSequenceExclusions,
  mktSequenceItems,
  mktSequences,
} from "../database/crm-schema";
import { requireCrmAccess } from "../utils/require-crm-access";

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<
    string,
    unknown
  >[];
}

/**
 * NOTE ON SEQUENCE ITEM STATUS: the values are
 * sent | failed | scheduled | cancelled. The Drizzle column DEFAULTS to
 * 'pending', which is not a value any row actually holds — filtering on
 * 'pending' silently returns zero rows and the follow-ups panel renders empty
 * while sequences are genuinely in flight. Caught by comparing against the
 * legacy dashboard, which showed 9 where this showed 0.
 */

/** Statuses meaning the message actually left the system. */
const SENT_STATUSES = sql`('sent','delivered','opened','clicked','bounced','complained')`;

const marketing = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)
  /**
   * Dashboard counters over a rolling window.
   *
   * Keyed off status rather than the presence of a provider id: Resend rows
   * carry a resend_id and Mailu SMTP rows do not, so counting by provider would
   * silently under-report every SMTP send.
   */
  .get("/stats", async (c) => {
    const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? "30") || 30));

    const [totals] = rows(
      await crmDb.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ${SENT_STATUSES})::int AS sent,
          COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int    AS delivered,
          COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int       AS opened,
          COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int      AS clicked,
          COUNT(*) FILTER (WHERE bounced_at IS NOT NULL)::int      AS bounced
        FROM mkt_emails
        WHERE sent_date > now() - (${days} * interval '1 day')
      `),
    );

    // Per-sending-identity deliverability. Legacy rows have a null
    // from_account_id and are attributed to the default sender.
    const bySender = rows(
      await crmDb.execute(sql`
        SELECT COALESCE(from_account_id, '(default)') AS sender,
               COUNT(*) FILTER (WHERE status IN ${SENT_STATUSES})::int AS sent,
               COUNT(*) FILTER (WHERE bounced_at IS NOT NULL)::int     AS bounced,
               COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int      AS opened,
               COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int     AS clicked
          FROM mkt_emails
         WHERE sent_date > now() - (${days} * interval '1 day')
         GROUP BY 1
         ORDER BY sent DESC
      `),
    );

    // Headline counts the dashboard shows alongside the rates.
    const [counts] = rows(
      await crmDb.execute(sql`
        SELECT (SELECT COUNT(*) FROM mkt_contacts)::int  AS contacts,
               (SELECT COUNT(*) FROM mkt_templates)::int AS templates,
               (SELECT COUNT(*) FROM mkt_sequence_exclusions)::int AS unsubscribed
      `),
    );

    return c.json({ days, totals: totals ?? {}, bySender, counts: counts ?? {} });
  })
  /**
   * Active follow-ups — sequences still in flight, with per-recipient progress.
   *
   * Grouped in SQL rather than in JS: one row per sequence with its sent/total
   * step counts and the next scheduled send. "Overdue" is left for the UI to
   * derive from next_send, because what counts as late is a display decision.
   */
  .get("/followups", async (c) => {
    const items = rows(
      await crmDb.execute(sql`
        SELECT s.id,
               s.campaign,
               MIN(i.contact_email) AS contact_email,
               MIN(i.subject)       AS subject,
               COUNT(i.id)::int                                      AS total_steps,
               COUNT(i.id) FILTER (WHERE i.status = 'sent')::int      AS sent_steps,
               MIN(i.scheduled_at) FILTER (WHERE i.status = 'scheduled') AS next_send
          FROM mkt_sequences s
          JOIN mkt_sequence_items i ON i.sequence_id = s.id
         WHERE s.status = 'active'
         GROUP BY s.id, s.campaign
        HAVING COUNT(i.id) FILTER (WHERE i.status = 'scheduled') > 0
         ORDER BY next_send ASC NULLS LAST
         LIMIT 50
      `),
    );

    return c.json({ items });
  })
  /** Thread list, newest activity first. */
  .get("/threads", async (c) => {
    const limit = Math.min(200, Number(c.req.query("limit") ?? "50") || 50);
    const q = c.req.query("q")?.trim();

    const items = rows(
      await crmDb.execute(sql`
        SELECT t.id, t.subject, t.last_activity_date,
               COUNT(e.id)::int AS message_count,
               MAX(e.status) AS last_status,
               MIN(u.email) AS participant
          FROM mkt_threads t
          LEFT JOIN mkt_emails e ON e.thread_id = t.id
          LEFT JOIN mkt_users  u ON u.id = e.recipient_id
         ${q ? sql`WHERE t.subject ILIKE ${`%${q}%`} OR u.email ILIKE ${`%${q}%`}` : sql``}
         GROUP BY t.id, t.subject, t.last_activity_date
         ORDER BY t.last_activity_date DESC NULLS LAST
         LIMIT ${limit}
      `),
    );

    return c.json({ items });
  })
  /** One thread with its messages, oldest first so it reads as a conversation. */
  .get("/threads/:id", async (c) => {
    const id = Number(c.req.param("id"));

    const items = rows(
      await crmDb.execute(sql`
        SELECT e.id, e.subject, e.body, e.body_html, e.sent_date, e.status,
               e.provider, e.from_account_id,
               e.delivered_at, e.opened_at, e.clicked_at, e.bounced_at,
               e.opened_count, e.clicked_count,
               s.email AS sender_email, r.email AS recipient_email
          FROM mkt_emails e
          LEFT JOIN mkt_users s ON s.id = e.sender_id
          LEFT JOIN mkt_users r ON r.id = e.recipient_id
         WHERE e.thread_id = ${id}
         ORDER BY e.sent_date ASC
      `),
    );

    return c.json({ items });
  })
  .get("/contacts", async (c) => {
    const limit = Math.min(500, Number(c.req.query("limit") ?? "200") || 200);
    const q = c.req.query("q")?.trim();

    const items = rows(
      await crmDb.execute(sql`
        SELECT id, first_name, last_name, email, company, tags,
               last_engagement, created_at
          FROM mkt_contacts
         ${q ? sql`WHERE email ILIKE ${`%${q}%`} OR company ILIKE ${`%${q}%`}` : sql``}
         ORDER BY created_at DESC NULLS LAST
         LIMIT ${limit}
      `),
    );

    return c.json({ items });
  })
  /** Sequences with their per-item progress. */
  .get("/sequences", async (c) => {
    const items = rows(
      await crmDb.execute(sql`
        SELECT s.id, s.campaign, s.status, s.sender_id, s.created_at,
               COUNT(i.id)::int AS total_items,
               COUNT(i.id) FILTER (WHERE i.status = 'sent')::int    AS sent_items,
               COUNT(i.id) FILTER (WHERE i.status = 'scheduled')::int AS pending_items
          FROM mkt_sequences s
          LEFT JOIN mkt_sequence_items i ON i.sequence_id = s.id
         GROUP BY s.id, s.campaign, s.status, s.sender_id, s.created_at
         ORDER BY s.created_at DESC
         LIMIT 100
      `),
    );

    return c.json({ items });
  })
  .get("/templates", async (c) => {
    const items = rows(
      await crmDb.execute(sql`
        -- body_html / body_text, not "body". There is no body column on this
        -- table; selecting one returned errorMissingColumn and blanked the
        -- whole compose page. Aliased back to "body" so the UI contract and
        -- the composer template picker are unchanged.
        SELECT id, name, subject,
               COALESCE(body_text, body_html) AS body,
               body_html, body_text, created_at
          FROM mkt_templates ORDER BY created_at DESC LIMIT 100
      `),
    );
    return c.json({ items });
  });


/*
 * The Stop List — mkt_sequence_exclusions.
 *
 * The dispatcher has always honoured this table; nothing on this stack could
 * write to it, so "please stop emailing me" had no button behind it. Ported
 * from apps/web/app/api/marketing/sequence-exclusions/route.ts, with the same
 * upsert-on-duplicate behaviour: re-adding an address refreshes the reason and
 * timestamp rather than 409-ing, because the person doing this is reacting to
 * an angry reply and does not need an error.
 */
marketing.get("/exclusions", async (c) => {
  const email = c.req.query("email");
  const items = await crmDb
    .select()
    .from(mktSequenceExclusions)
    .where(email ? eq(mktSequenceExclusions.email, email) : undefined)
    .orderBy(desc(mktSequenceExclusions.createdAt))
    .limit(Number(c.req.query("limit") ?? 200));
  return c.json({ items });
});

marketing.post("/exclusions", async (c) => {
  const body = await c.req
    .json<{ email?: string; reason?: string }>()
    .catch(() => ({}) as { email?: string; reason?: string });
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    throw new HTTPException(400, { message: "Email is required" });
  }

  const [existing] = await crmDb
    .select({ id: mktSequenceExclusions.id, reason: mktSequenceExclusions.reason })
    .from(mktSequenceExclusions)
    .where(eq(mktSequenceExclusions.email, email))
    .limit(1);

  if (existing) {
    await crmDb
      .update(mktSequenceExclusions)
      .set({ reason: body.reason || existing.reason, createdAt: new Date() })
      .where(eq(mktSequenceExclusions.id, existing.id));
    return c.json({ ok: true, id: existing.id, updated: true });
  }

  const [row] = await crmDb
    .insert(mktSequenceExclusions)
    .values({ email, reason: body.reason || null })
    .returning({ id: mktSequenceExclusions.id });

  return c.json({ ok: true, id: row?.id, updated: false });
});

marketing.delete("/exclusions", async (c) => {
  const email = c.req.query("email");
  const id = c.req.query("id");
  if (!email && !id) {
    throw new HTTPException(400, { message: "Email or id is required" });
  }
  await crmDb
    .delete(mktSequenceExclusions)
    .where(
      email
        ? eq(mktSequenceExclusions.email, email)
        : eq(mktSequenceExclusions.id, Number(id)),
    );
  return c.json({ ok: true });
});

/*
 * Stop a running sequence. Sets the sequence inactive AND cancels its
 * not-yet-sent steps — the dispatcher already skips non-active sequences, but
 * leaving the steps "scheduled" makes the dashboard keep counting work that
 * will never happen, which is how the queue looked alive while being dead.
 */
marketing.post("/sequences/:id/stop", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) {
    throw new HTTPException(400, { message: "Bad sequence id" });
  }

  await crmDb
    .update(mktSequences)
    .set({ status: "stopped", updatedAt: new Date() })
    .where(eq(mktSequences.id, id));

  const cancelled = await crmDb
    .update(mktSequenceItems)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(mktSequenceItems.sequenceId, id),
        inArray(mktSequenceItems.status, ["scheduled", "pending"]),
      ),
    )
    .returning({ id: mktSequenceItems.id });

  return c.json({ ok: true, cancelledSteps: cancelled.length });
});

/*
 * Sending. Mounted as a sub-router so the send path keeps its own file — it is
 * a 300-line pipeline whose ordering matters, and burying it among the read
 * handlers is how the ordering gets casually rearranged.
 */
marketing.route("/send", send);

/** The "from" identities the composer offers. */
marketing.get("/senders", (c) => {
  const accounts = getSendingAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    fromEmail: a.fromEmail,
    replyTo: a.replyTo,
  }));
  return c.json({ items: accounts });
});

/**
 * Deliverability pre-check for the composer.
 *
 * The same verdict the send path enforces, surfaced before the user hits send
 * so a dead mailbox is a warning rather than a 422 after the fact. Cached in
 * mkt_email_verifications, so asking twice costs nothing.
 */
marketing.post("/validate-email", async (c) => {
  const parsed = await c.req
    .json<{ email?: string }>()
    .catch(() => ({}) as { email?: string });
  const email = parsed.email;
  if (!email) return c.json({ error: "email is required" }, 400);
  /*
   * The FULL legacy result, not the bare Reacher verdict.
   *
   * This returned `verifyEmail()`'s output — {reachable, ...} — while the UI
   * (ported from crmx1 along with the lead email dialog) reads score, issues,
   * isValidFormat and hasMxRecords. `result.issues.length` on an absent array
   * threw "Cannot read properties of undefined (reading 'length')" and took
   * the whole Review Email dialog down with it.
   *
   * validateEmail is crmx1's validator verbatim: syntax, MX lookup, disposable
   * and free-provider lists, typo detection, then the Reacher SMTP probe.
   */
  return c.json(await validateEmail(email));
});


/**
 * Cap share link -> email-safe GIF card markup.
 *
 * Ported from apps/web/app/api/videos/embed-html. The composer previews the
 * card before sending; iframes never render in a mail client, so the video has
 * to become a static image wrapped in a link.
 */
marketing.post("/video-embed", async (c) => {
  const parsed = await c.req
    .json<{ url?: string }>()
    .catch(() => ({}) as { url?: string });
  const url = parsed.url;
  if (!url) return c.json({ error: "url is required" }, 400);
  if (!extractCapVideoId(url)) {
    return c.json({ error: "Not a Cap share link" }, 400);
  }
  try {
    const embed = await resolveCapEmbed(url);
    return c.json({ html: renderVideoCardHtml(embed), embed });
  } catch (err) {
    console.warn("[marketing] cap embed failed", err);
    return c.json({ error: "Could not resolve that Cap video" }, 502);
  }
});


/**
 * Inline image upload for the composer's editor.
 *
 * Mirrors the legacy CKEditor upload adapter contract: multipart field named
 * `upload`, response `{ url }`. Kept identical so the editor's upload handler
 * is a straight port rather than a reinvention.
 *
 * The URL must be PUBLIC and permanent — it ends up as an <img src> inside mail
 * that has already been delivered, and a presigned link would expire while the
 * message is still in someone's inbox.
 */
marketing.post("/upload-image", async (c) => {
  const form = await c.req.parseBody();
  const file = form.upload ?? form.file;

  if (!(file instanceof File)) {
    return c.json({ error: "No file uploaded (field: upload)" }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Only images can be embedded" }, 400);
  }
  // Mail clients choke on huge inline images and some providers reject the
  // message outright, so refuse here rather than at send time.
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: "Images must be under 5 MB" }, 413);
  }

  const ext = (file.name.split(".").pop() || "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const key = `marketing/inline/${crypto.randomUUID()}.${ext}`;

  const { url } = await put(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
  });

  return c.json({ url });
});

export default marketing;
