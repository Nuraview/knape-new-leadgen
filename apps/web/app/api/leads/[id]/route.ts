import { NextRequest, NextResponse } from "next/server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads, crmLeadStatuses, crmLeadViews, crmActivityEvents, users } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free-text fields default to null when explicitly cleared by the UI. We
// don't trim or normalize here — the drawer's onBlur sends the user's
// literal value. The DB has lastName as NOT NULL, so an empty string is
// stored if the field is wiped (the existing migration default).
const NullableText = z.string().nullable().optional();

const PatchSchema = z
  .object({
    leadStatusId: z.uuid().optional().nullable(),
    assignedTo: z.uuid().optional().nullable(),
    highlighted: z.boolean().optional(),
    lastContactedAt: z.iso.datetime().optional().nullable(),
    reminderAt: z.iso.datetime().optional().nullable(),
    reminderNote: NullableText,
    // Which recipient this lead's reminder goes to (matches a key in
    // WHATSAPP_RECIPIENTS env var, e.g. "VK" or "AbdulMateen"). null = fallback.
    reminderAccount: z.string().max(64).nullable().optional(),
    // Manual contact fields — editable from the lead drawer (Apr 2026).
    firstName: NullableText,
    lastName: NullableText,
    company: NullableText,
    jobTitle: NullableText,
    email: NullableText,
    emailSecondary: NullableText,
    phone: NullableText,
    phoneSecondary: NullableText,
    linkedinUrl: NullableText,
    // Cap share URL — per-lead video recording (Loom replacement), embedded
    // as a GIF thumbnail card when the outreach email is sent.
    videoLink: NullableText,
    description: NullableText,
    // Irrelevant mark — the reviewer's "this is not even our service" flag.
    // `irrelevant: true` stamps now() + the actor; `false` clears the mark
    // (and the reason, since it'd be misleading to keep). `irrelevantReason`
    // can be sent independently to update the captured reason without
    // toggling the mark.
    irrelevant: z.boolean().optional(),
    irrelevantReason: NullableText,
    // AI-generated email draft — persisted so the reviewer can navigate
    // away and come back without losing the generated content.
    generatedEmailSubject: NullableText,
    generatedEmailBody: NullableText,
  })
  .strict();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  // Same UTC-aware serialization as /api/leads — prevents the ~5.5h TZ drift
  // for clients in IST viewing naked TIMESTAMP columns.
  const isoUtc = (col: any) =>
    sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

  // See /api/leads — lift client location out of source_payload, drop the
  // scraper's sentinel strings.
  const clientLocationSql = sql`
    COALESCE(
      NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'client_location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown'),
      NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown')
    )
  `;

  const [row] = await db
    .select({
      id: crmLeads.id,
      company: crmLeads.company,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      jobTitle: crmLeads.jobTitle,
      email: crmLeads.email,
      emailSecondary: crmLeads.emailSecondary,
      phone: crmLeads.phone,
      phoneSecondary: crmLeads.phoneSecondary,
      linkedinUrl: crmLeads.linkedinUrl,
      videoLink: crmLeads.videoLink,
      description: crmLeads.description,
      upworkJobUrl: crmLeads.upworkJobUrl,
      upworkJobId: crmLeads.upworkJobId,
      extractedAt: isoUtc(crmLeads.extractedAt),
      createdAt: isoUtc(crmLeads.createdAt),
      postedAt: isoUtc(crmLeads.postedAt),
      // Raw "posted X ago" string exactly as the scraper read it off the Upwork
      // posting (e.g. "1 hour ago"). Shown verbatim in the drawer — no relative
      // recompute — since that's the value the client wants to see. Junk
      // sentinels collapse to NULL so the line hides.
      postedRaw: sql<string | null>`
        NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'posted_at', ''), 'Unknown'), '·')
      `,
      highlightedAt: isoUtc(crmLeads.highlightedAt),
      highlightedBy: crmLeads.highlightedBy,
      lastContactedAt: isoUtc(crmLeads.lastContactedAt),
      lastContactedBy: crmLeads.lastContactedBy,
      reminderAt: isoUtc(crmLeads.reminderAt),
      reminderSentAt: isoUtc(crmLeads.reminderSentAt),
      reminderFirstSentAt: isoUtc(crmLeads.reminderFirstSentAt),
      reminderFollowupPending: crmLeads.reminderFollowupPending,
      reminderNote: crmLeads.reminderNote,
      reminderAccount: crmLeads.reminderAccount,
      sourcePayload: crmLeads.sourcePayload,
      leadStatusId: crmLeads.leadStatusId,
      statusName: crmLeadStatuses.name,
      irrelevantAt: isoUtc(crmLeads.irrelevantAt),
      irrelevantBy: crmLeads.irrelevantBy,
      irrelevantReason: crmLeads.irrelevantReason,
      clientLocation: clientLocationSql,
      assignedTo: crmLeads.assignedTo,
      assigneeName: users.name,
      assigneeWhatsApp: users.whatsApp,
      generatedEmailSubject: crmLeads.generatedEmailSubject,
      generatedEmailBody: crmLeads.generatedEmailBody,
      // Snapshot of the email actually sent — shown in the drawer below the
      // Email Generator so the reviewer can see what went out (subject + To/CC,
      // body on expand). Captured at send time in send-email/route.ts.
      sentEmailSubject: crmLeads.sentEmailSubject,
      sentEmailBody: crmLeads.sentEmailBody,
      sentEmailTo: crmLeads.sentEmailTo,
      sentEmailCc: crmLeads.sentEmailCc,
    })
    .from(crmLeads)
    .leftJoin(crmLeadStatuses, eq(crmLeads.leadStatusId, crmLeadStatuses.id))
    .leftJoin(users, eq(crmLeads.assignedTo, users.id))
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Stamp the view. Drawer-open = "I have eyeballed this lead", which is
  // exactly what we want the 👁 icon in the list to reflect. ON CONFLICT
  // refreshes viewed_at on every subsequent open so the timestamp always
  // tracks the most recent visit. Fire-and-forget is fine — we don't want
  // a slow write to block the detail render.
  void db
    .insert(crmLeadViews)
    .values({ leadId: id, userId: session.user.id })
    .onConflictDoUpdate({
      target: [crmLeadViews.leadId, crmLeadViews.userId],
      set: { viewedAt: sql`CURRENT_TIMESTAMP` },
    })
    .catch(() => {
      // Stamping is best-effort. If it fails (e.g. transient DB blip), the
      // user just won't see the eye icon yet — the next open will retry.
    });

  return NextResponse.json({ lead: row });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  let patch: z.infer<typeof PatchSchema>;
  try {
    const json = await req.json();
    patch = PatchSchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid patch", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update: Record<string, any> = { updatedAt: now };

  if (patch.leadStatusId !== undefined) {
    update.leadStatusId = patch.leadStatusId;
  }
  if (patch.assignedTo !== undefined) {
    update.assignedTo = patch.assignedTo;
  }
  if (patch.highlighted !== undefined) {
    update.highlightedAt = patch.highlighted ? now : null;
    update.highlightedBy = patch.highlighted ? session.user.id : null;
  }
  if (patch.lastContactedAt !== undefined) {
    update.lastContactedAt = patch.lastContactedAt;
    update.lastContactedBy = patch.lastContactedAt ? session.user.id : null;
  }
  if (patch.reminderAt !== undefined) {
    // User-driven reminder change cancels the auto +6h follow-up but
    // does NOT clear reminderFirstSentAt — that field anchors the 24h
    // "stay in Reminders column" behaviour and must survive user
    // actions. The cron overwrites first_sent_at on each new "first
    // send", so a fresh cycle's first fire will refresh it naturally.
    //
    //   - Setting a new time → next cron fire is a "first send" again
    //     (because followup_pending is now false), schedules its own +6h.
    //   - Cancelling (null) → no future fires.
    update.reminderAt = patch.reminderAt;
    update.reminderSentAt = null;
    update.reminderFollowupPending = false;
  }
  if (patch.reminderNote !== undefined) {
    update.reminderNote = patch.reminderNote;
  }
  if (patch.reminderAccount !== undefined) {
    update.reminderAccount = patch.reminderAccount?.trim() || null;
  }
  if (patch.irrelevant !== undefined) {
    if (patch.irrelevant) {
      update.irrelevantAt = now;
      update.irrelevantBy = session.user.id;
      // If the same payload also carries a reason, pick it up here so the
      // mark + reason land in one row update. Otherwise leave the column
      // alone for a follow-up reason edit.
      if (patch.irrelevantReason !== undefined) {
        update.irrelevantReason = patch.irrelevantReason;
      }
    } else {
      // Restoring: wipe the trio so the row is fully back in the active
      // pool. Keeping the old reason would be misleading once the mark is
      // gone.
      update.irrelevantAt = null;
      update.irrelevantBy = null;
      update.irrelevantReason = null;
    }
  } else if (patch.irrelevantReason !== undefined) {
    // Reason-only edit — the reviewer is refining their note on a row
    // that's already marked. Don't touch the mark itself.
    update.irrelevantReason = patch.irrelevantReason;
  }

  // Manual contact / detail fields — pass through directly. Empty string is
  // preserved so reviewers can intentionally clear a value via the UI.
  for (const key of [
    "firstName",
    "lastName",
    "company",
    "jobTitle",
    "email",
    "emailSecondary",
    "phone",
    "phoneSecondary",
    "linkedinUrl",
    "videoLink",
    "description",
    "generatedEmailSubject",
    "generatedEmailBody",
  ] as const) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }

  // Snapshot the primary contact fields BEFORE the write so we can tell whether
  // this edit actually set/changed them (vs a no-op save or an unrelated field
  // edit) — that's the signal for an outreach activity recorded below.
  let prevContact: { email: string | null; phone: string | null } | undefined;
  if (patch.email !== undefined || patch.phone !== undefined) {
    const [p] = await db
      .select({ email: crmLeads.email, phone: crmLeads.phone })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
      .limit(1);
    prevContact = p;
  }

  const rowsResult: any = await db
    .update(crmLeads)
    .set(update)
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .returning();

  const rows: any[] = Array.isArray(rowsResult)
    ? rowsResult
    : (rowsResult?.rows ?? []);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Activity tracking (Daily Activity dashboard): adding/changing a lead's
  // PRIMARY phone means "I called", primary email means "I emailed". The edit
  // itself is the signal — no extra clicks (VK's "path of least resistance").
  // This route is the human drawer editor, so AI enrichment / follow-ups (which
  // write leads on other code paths) never count as manual outreach. We only
  // fire when the value is non-empty AND actually changed, so a no-op save or
  // re-save of the same number/email won't double-count. Fire-and-forget.
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const activityTypes: ("call" | "email")[] = [];
  if (
    patch.phone !== undefined &&
    norm(rows[0].phone) &&
    norm(rows[0].phone) !== norm(prevContact?.phone)
  ) {
    activityTypes.push("call");
  }
  if (
    patch.email !== undefined &&
    norm(rows[0].email) &&
    norm(rows[0].email) !== norm(prevContact?.email)
  ) {
    activityTypes.push("email");
  }
  if (activityTypes.length > 0) {
    void db
      .insert(crmActivityEvents)
      .values(
        activityTypes.map((type) => ({ userId: session.user.id, type, leadId: id })),
      )
      .catch(() => {
        // Best-effort: a tracking miss must never fail the user's edit.
      });
  }

  return NextResponse.json({ lead: rows[0] });
}
