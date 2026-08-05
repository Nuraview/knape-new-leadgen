import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { toTitleCase } from './utils';
import {
  getDefaultSendingAccount,
  sendingAccountLabel,
} from '@/lib/marketing/sending-accounts';
import { db } from '@/lib/db';
import { crmLeads } from '@/lib/db';
import {
  mktContacts as contacts,
  mktEmails as emails,
  mktFolders as folders,
  mktSequenceExclusions as exclusions,
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
  mktTemplates as templates,
  mktThreadFolders as threadFolders,
  mktThreads as threads,
  mktUsers as users,
} from '@/lib/db';

type Folder = {
  name: string;
  thread_count: number;
};

export async function getFoldersWithThreadCount() {

  let foldersWithCount = await db
    .select({
      name: folders.name,
      thread_count: sql<number>`count(${threadFolders.threadId})`.as(
        'thread_count',
      ),
    })
    .from(folders)
    .leftJoin(threadFolders, eq(folders.id, threadFolders.folderId))
    .groupBy(folders.name);

  let specialFoldersOrder = ['Inbox', 'Flagged', 'Sent'];
  let specialFolders = specialFoldersOrder
    .map((name) => foldersWithCount.find((folder) => folder.name === name))
    .filter(Boolean) as Folder[];
  let otherFolders = foldersWithCount.filter(
    (folder) => !specialFoldersOrder.includes(folder.name),
  ) as Folder[];

  return { specialFolders, otherFolders };
}

export async function getThreadsForFolder(folderName: string) {

  let originalFolderName = toTitleCase(decodeURIComponent(folderName));

  const threadsWithEmails = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      lastActivityDate: threads.lastActivityDate,
      emails: sql<
        {
          id: number;
          senderId: number;
          recipientId: number;
          subject: string;
          body: string;
          bodyHtml: string | null;
          sentDate: Date;
          resendId: string | null;
          status: 'draft' | 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed' | null;
          openedCount: number;
          clickedCount: number;
          openedAt: Date | null;
          clickedAt: Date | null;
          deliveredAt: Date | null;
          bouncedAt: Date | null;
          sender: {
            id: number;
            firstName: string;
            lastName: string;
            email: string;
          };
        }[]
      >`json_agg(json_build_object(
        'id', ${emails.id},
        'senderId', ${emails.senderId},
        'recipientId', ${emails.recipientId},
        'subject', ${emails.subject},
        'body', ${emails.body},
        'bodyHtml', ${emails.bodyHtml},
        'sentDate', ${emails.sentDate},
        'resendId', ${emails.resendId},
        'status', ${emails.status},
        'openedCount', ${emails.openedCount},
        'clickedCount', ${emails.clickedCount},
        'openedAt', ${emails.openedAt},
        'clickedAt', ${emails.clickedAt},
        'deliveredAt', ${emails.deliveredAt},
        'bouncedAt', ${emails.bouncedAt},
        'sender', json_build_object(
          'id', ${users.id},
          'firstName', ${users.firstName},
          'lastName', ${users.lastName},
          'email', ${users.email}
        )
      ) ORDER BY ${emails.sentDate} DESC)`,
    })
    .from(threads)
    .innerJoin(threadFolders, eq(threads.id, threadFolders.threadId))
    .innerJoin(folders, eq(threadFolders.folderId, folders.id))
    .innerJoin(emails, eq(threads.id, emails.threadId))
    .innerJoin(users, eq(emails.senderId, users.id))
    .where(eq(folders.name, originalFolderName))
    .groupBy(threads.id)
    .orderBy(desc(threads.lastActivityDate));

  return threadsWithEmails;
}

export async function searchThreads(search: string | undefined) {
  if (!search) {
    return [];
  }

  const results = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      lastActivityDate: threads.lastActivityDate,
      folderName: folders.name,
      emailId: emails.id,
      emailSubject: emails.subject,
      emailBody: emails.body,
      emailSentDate: emails.sentDate,
      emailStatus: emails.status,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(threads)
    .innerJoin(emails, eq(threads.id, emails.threadId))
    .innerJoin(users, eq(emails.senderId, users.id))
    .leftJoin(threadFolders, eq(threads.id, threadFolders.threadId))
    .leftJoin(folders, eq(threadFolders.folderId, folders.id))
    .where(
      or(
        ilike(users.firstName, `%${search}%`),
        ilike(users.lastName, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(threads.subject, `%${search}%`),
        ilike(emails.body, `%${search}%`),
      ),
    )
    .orderBy(desc(threads.lastActivityDate), desc(emails.sentDate));

  const threadMap = new Map();
  for (const result of results) {
    if (!threadMap.has(result.id)) {
      threadMap.set(result.id, {
        id: result.id,
        subject: result.subject,
        lastActivityDate: result.lastActivityDate,
        folderName: result.folderName,
        latestEmail: {
          id: result.emailId,
          subject: result.emailSubject,
          body: result.emailBody,
          sentDate: result.emailSentDate,
          status: result.emailStatus,
          sender: {
            firstName: result.senderFirstName,
            lastName: result.senderLastName,
            email: result.senderEmail,
          },
        },
      });
    }
  }

  return Array.from(threadMap.values());
}

export async function getThreadInFolder(folderName: string, threadId: string) {

  let originalFolderName = toTitleCase(decodeURIComponent(folderName));
  let result = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      lastActivityDate: threads.lastActivityDate,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderEmail: users.email,
    })
    .from(threads)
    .innerJoin(threadFolders, eq(threads.id, threadFolders.threadId))
    .innerJoin(folders, eq(threadFolders.folderId, folders.id))
    .innerJoin(emails, eq(threads.id, emails.threadId))
    .innerJoin(users, eq(emails.senderId, users.id))
    .where(
      and(
        eq(folders.name, originalFolderName),
        eq(threads.id, parseInt(threadId)),
      ),
    );

  return result[0];
}

export async function getEmailsForThread(threadId: string) {

  const result = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      emailId: emails.id,
      body: emails.body,
      bodyHtml: emails.bodyHtml,
      sentDate: emails.sentDate,
      senderId: users.id,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      recipientId: emails.recipientId,
      // Resend fields
      resendId: emails.resendId,
      status: emails.status,
      openedCount: emails.openedCount,
      clickedCount: emails.clickedCount,
      openedAt: emails.openedAt,
      clickedAt: emails.clickedAt,
      deliveredAt: emails.deliveredAt,
      bouncedAt: emails.bouncedAt,
    })
    .from(threads)
    .innerJoin(emails, eq(threads.id, emails.threadId))
    .innerJoin(users, eq(emails.senderId, users.id))
    .where(eq(threads.id, parseInt(threadId, 10)))
    .orderBy(emails.sentDate);

  if (result.length === 0) {
    return null;
  }

  const thread = {
    id: result[0].id,
    subject: result[0].subject,
    emails: result.map((row) => ({
      id: row.emailId,
      body: row.body,
      bodyHtml: row.bodyHtml,
      sentDate: row.sentDate,
      sender: {
        id: row.senderId,
        firstName: row.senderFirstName,
        lastName: row.senderLastName,
      },
      recipientId: row.recipientId,
      // Resend engagement data
      resendId: row.resendId,
      status: row.status,
      openedCount: row.openedCount,
      clickedCount: row.clickedCount,
      openedAt: row.openedAt,
      clickedAt: row.clickedAt,
      deliveredAt: row.deliveredAt,
      bouncedAt: row.bouncedAt,
    })),
  };

  return thread;
}

export async function getAllEmailAddresses() {

  return db
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(users);
}

export async function getUserProfile(userId: number) {

  const userInfo = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      jobTitle: users.jobTitle,
      company: users.company,
      location: users.location,
      avatarUrl: users.avatarUrl,
      linkedin: users.linkedin,
      twitter: users.twitter,
      github: users.github,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .execute();

  if (userInfo.length === 0) {
    return null;
  }

  const latestThreads = await db
    .select({
      subject: threads.subject,
    })
    .from(threads)
    .innerJoin(emails, eq(emails.threadId, threads.id))
    .where(eq(emails.senderId, userId))
    .orderBy(desc(threads.lastActivityDate))
    .limit(3)
    .execute();

  return {
    ...userInfo[0],
    latestThreads,
  };
}

// ── Contacts ─────────────────────────────────────────────

type LeadEnrichment = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  upworkJobUrl: string | null;
};

// Build a lower(email) → richest lead card map, used to fill in Name / Company /
// Phone wherever we only have an email (contacts list, engagement panels). A
// single email can map to several lead cards (e.g. an Upwork post re-scraped),
// so we collapse to ONE card per email — prefer cards that carry a phone, then
// company, then a name, then the most recent. Collapsing here is what stops a
// row from fanning out into duplicates when joined.
async function getLeadEnrichmentByEmail(): Promise<Map<string, LeadEnrichment>> {
  const leads = await db
    .select({
      email: crmLeads.email,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      company: crmLeads.company,
      phone: crmLeads.phone,
      linkedinUrl: crmLeads.linkedinUrl,
      jobTitle: crmLeads.jobTitle,
      upworkJobUrl: crmLeads.upworkJobUrl,
      createdAt: crmLeads.createdAt,
    })
    .from(crmLeads)
    .where(and(isNull(crmLeads.deletedAt), isNotNull(crmLeads.email)));

  const score = (l: { phone: string | null; company: string | null; firstName: string | null }) =>
    (l.phone ? 4 : 0) + (l.company ? 2 : 0) + (l.firstName ? 1 : 0);

  const map = new Map<string, (typeof leads)[number]>();
  for (const l of leads) {
    const key = l.email?.trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, l);
    } else if (
      score(l) > score(existing) ||
      (score(l) === score(existing) &&
        String(l.createdAt ?? '') > String(existing.createdAt ?? ''))
    ) {
      map.set(key, l);
    }
  }
  return map;
}

export type ContactWithLead = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  tags: unknown;
  lastEngagement: Date | null;
  createdAt: Date | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  upworkJobUrl: string | null;
};

export async function getContacts(): Promise<ContactWithLead[]> {
  const rows = await db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.createdAt));

  // Fill in Name / Company / Phone from the matching lead card (by email). The
  // contacts table stores almost no names and no phone at all, so the lead cards
  // are the source of truth. Where the lead card has nothing, the contact stays
  // as-is.
  const leadByEmail = await getLeadEnrichmentByEmail();

  // Merge + defensively collapse any case-variant duplicate contact emails.
  // Rows are ordered newest-first, so the first occurrence per email wins.
  const seen = new Set<string>();
  const merged: ContactWithLead[] = [];
  for (const c of rows) {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lead = leadByEmail.get(key);
    merged.push({
      id: c.id,
      email: c.email,
      tags: c.tags,
      lastEngagement: c.lastEngagement,
      createdAt: c.createdAt,
      firstName: c.firstName || lead?.firstName || null,
      lastName: c.lastName || lead?.lastName || null,
      company: c.company || lead?.company || null,
      phone: lead?.phone || null,
      linkedinUrl: lead?.linkedinUrl || null,
      jobTitle: lead?.jobTitle || null,
      upworkJobUrl: lead?.upworkJobUrl || null,
    });
  }
  return merged;
}

export async function getContactById(id: number) {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
  return contact ?? null;
}

// ── Templates ────────────────────────────────────────────

export async function getTemplates() {
  return db
    .select()
    .from(templates)
    .orderBy(desc(templates.updatedAt));
}

export async function getTemplateById(id: number) {
  const [template] = await db.select().from(templates).where(eq(templates.id, id));
  return template ?? null;
}

// ── Dashboard / Analytics ────────────────────────────────

// The dashboard only ever reflects a rolling window of recent activity — email
// metrics older than this "expire" off the dashboard (the rows stay in the DB,
// they're just no longer counted/shown here).
const DASHBOARD_WINDOW_DAYS = 7;
function dashboardCutoff(): Date {
  return new Date(Date.now() - DASHBOARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export async function getDashboardStats() {
  // No caching — dashboard stats should always be fresh (real-time analytics)
  const cutoff = dashboardCutoff();

  // Count anything that actually left the system (provider-agnostic — Resend
  // rows carry a resendId, Mailu SMTP rows do not, so key off status).
  const [totalSent] = await db
    .select({ value: count() })
    .from(emails)
    .where(
      and(
        inArray(emails.status, [
          "sent", "delivered", "opened", "clicked", "bounced", "complained",
        ]),
        gte(emails.sentDate, cutoff),
      ),
    );

  const [totalDelivered] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(isNotNull(emails.deliveredAt), gte(emails.sentDate, cutoff)));

  const [totalOpened] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(isNotNull(emails.openedAt), gte(emails.sentDate, cutoff)));

  const [totalClicked] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(isNotNull(emails.clickedAt), gte(emails.sentDate, cutoff)));

  const [totalBounced] = await db
    .select({ value: count() })
    .from(emails)
    .where(and(isNotNull(emails.bouncedAt), gte(emails.sentDate, cutoff)));

  // Unsubscribes recorded within the window (added by the IMAP poller when a
  // recipient emails us "unsubscribe"). reason='unsubscribe' distinguishes
  // these from bounce-origin exclusions, which carry no reason.
  const [totalUnsubscribed] = await db
    .select({ value: count() })
    .from(exclusions)
    .where(
      and(
        eq(exclusions.reason, "unsubscribe"),
        gte(exclusions.createdAt, cutoff),
      ),
    );

  const [totalContacts] = await db
    .select({ value: count() })
    .from(contacts);

  const [totalTemplates] = await db
    .select({ value: count() })
    .from(templates);

  const recentEmails = await db
    .select({
      id: emails.id,
      subject: emails.subject,
      status: emails.status,
      sentDate: emails.sentDate,
      resendId: emails.resendId,
      provider: emails.provider,
      openedCount: emails.openedCount,
      clickedCount: emails.clickedCount,
      recipientEmail: users.email,
      recipientName: users.firstName,
    })
    .from(emails)
    .innerJoin(users, eq(emails.recipientId, users.id))
    .where(
      and(
        inArray(emails.status, [
          "sent", "delivered", "opened", "clicked", "bounced", "complained",
        ]),
        gte(emails.sentDate, cutoff),
      ),
    )
    .orderBy(desc(emails.sentDate))
    .limit(10);

  return {
    sent: totalSent.value,
    delivered: totalDelivered.value,
    opened: totalOpened.value,
    clicked: totalClicked.value,
    bounced: totalBounced.value,
    unsubscribed: totalUnsubscribed.value,
    contacts: totalContacts.value,
    templates: totalTemplates.value,
    recentEmails,
  };
}

// ── A/B provider deliverability comparison ───────────────
// Per-provider sent / opened / clicked / bounced + rates, for the marketing
// dashboard. "Sent" counts only rows that left the system (not draft/queued/failed).
const SENT_STATUSES = [
  "sent", "delivered", "opened", "clicked", "bounced", "complained",
] as const;

/**
 * Deliverability broken out by SENDING DOMAIN/identity (mkt_emails.from_account_id)
 * rather than by provider. Every send now records which account it went out as,
 * so each configured domain (creative-hive, nuraview.us, …) gets its own
 * sent/open/click/bounce card. Legacy rows with a null account are attributed to
 * the current default sender.
 */
export async function getSenderDeliverabilityStats() {
  const cutoff = dashboardCutoff();
  const defaultId = getDefaultSendingAccount().id;
  // Effective identity: stored id, or the default for legacy/null rows.
  const acct = sql<string>`COALESCE(${emails.fromAccountId}, ${defaultId})`;

  const rows = await db
    .select({
      accountId: acct,
      sent: sql<number>`count(*) FILTER (WHERE ${inArray(emails.status, [...SENT_STATUSES])})`.mapWith(Number),
      opened: sql<number>`count(*) FILTER (WHERE ${emails.openedAt} IS NOT NULL)`.mapWith(Number),
      clicked: sql<number>`count(*) FILTER (WHERE ${emails.clickedAt} IS NOT NULL)`.mapWith(Number),
      bounced: sql<number>`count(*) FILTER (WHERE ${emails.bouncedAt} IS NOT NULL)`.mapWith(Number),
    })
    .from(emails)
    .where(gte(emails.sentDate, cutoff))
    // GROUP BY 1 (the accountId select expression). Repeating `acct` here makes
    // Drizzle bind the default id as a second param, and Postgres then can't
    // prove the SELECT and GROUP BY expressions match (42803).
    .groupBy(sql`1`);

  return rows
    .map((r) => {
      const s = r.sent || 0;
      return {
        accountId: r.accountId,
        label: sendingAccountLabel(r.accountId),
        sent: s,
        opened: r.opened || 0,
        clicked: r.clicked || 0,
        bounced: r.bounced || 0,
        openRate: s > 0 ? (r.opened / s) * 100 : 0,
        clickRate: s > 0 ? (r.clicked / s) * 100 : 0,
        bounceRate: s > 0 ? (r.bounced / s) * 100 : 0,
      };
    })
    .sort((a, b) => b.sent - a.sent);
}

// ── Engagement drill-down (who opened / who clicked) ─────
// Powers the clickable "Opened" / "Clicked" dashboard cards: the list of
// recipients behind those numbers, enriched with company + phone from their
// lead card, plus the sent email so it can be previewed in the side panel.
export type EngagementRow = {
  id: number;
  subject: string | null;
  body: string | null;
  bodyHtml: string | null;
  sentDate: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  unsubscribedAt: Date | null;
  openedCount: number | null;
  clickedCount: number | null;
  recipientEmail: string;
  recipientName: string | null;
  company: string | null;
  phone: string | null;
};

export async function getEngagementDetails(
  kind: 'opened' | 'clicked' | 'unsubscribed',
): Promise<EngagementRow[]> {
  // Unsubscribes live in mkt_sequence_exclusions, not mkt_emails — there's no
  // "sent email" behind them, so this branch returns just the person + when.
  if (kind === 'unsubscribed') {
    const rows = await db
      .select({
        id: exclusions.id,
        email: exclusions.email,
        createdAt: exclusions.createdAt,
      })
      .from(exclusions)
      .where(
        and(
          eq(exclusions.reason, 'unsubscribe'),
          gte(exclusions.createdAt, dashboardCutoff()),
        ),
      )
      .orderBy(desc(exclusions.createdAt));

    const leadByEmail = await getLeadEnrichmentByEmail();

    return rows.map((r) => {
      const lead = leadByEmail.get(r.email?.trim().toLowerCase() ?? '');
      const fullName =
        [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() ||
        null;
      return {
        id: r.id,
        subject: null,
        body: null,
        bodyHtml: null,
        sentDate: null,
        openedAt: null,
        clickedAt: null,
        unsubscribedAt: r.createdAt ?? null,
        openedCount: null,
        clickedCount: null,
        recipientEmail: r.email,
        recipientName: fullName,
        company: lead?.company ?? null,
        phone: lead?.phone ?? null,
      };
    });
  }

  const marker = kind === 'opened' ? emails.openedAt : emails.clickedAt;

  const rows = await db
    .select({
      id: emails.id,
      subject: emails.subject,
      body: emails.body,
      bodyHtml: emails.bodyHtml,
      sentDate: emails.sentDate,
      openedAt: emails.openedAt,
      clickedAt: emails.clickedAt,
      openedCount: emails.openedCount,
      clickedCount: emails.clickedCount,
      recipientEmail: users.email,
      recipientName: users.firstName,
    })
    .from(emails)
    .innerJoin(users, eq(emails.recipientId, users.id))
    .where(and(isNotNull(marker), gte(emails.sentDate, dashboardCutoff())))
    .orderBy(desc(marker));

  const leadByEmail = await getLeadEnrichmentByEmail();

  return rows.map((r) => {
    const lead = leadByEmail.get(r.recipientEmail?.trim().toLowerCase() ?? '');
    const fullName =
      [lead?.firstName, lead?.lastName].filter(Boolean).join(' ').trim() || null;
    return {
      ...r,
      unsubscribedAt: null,
      recipientName: r.recipientName || fullName,
      company: lead?.company ?? null,
      phone: lead?.phone ?? null,
    };
  });
}

export async function getActiveSequenceForThread(resendIds: string[]) {
  if (resendIds.length === 0) return null;

  const results = await db
    .select({
      sequenceId: sequences.id,
      sequenceStatus: sequences.status,
      campaign: sequences.campaign,
      itemStatus: sequenceItems.status,
    })
    .from(sequenceItems)
    .innerJoin(sequences, eq(sequences.id, sequenceItems.sequenceId))
    .where(
      and(
        inArray(sequenceItems.messageIdHeader, resendIds),
        eq(sequences.status, 'active'),
      ),
    );

  if (results.length === 0) return null;

  const sequenceId = results[0].sequenceId;
  const campaign = results[0].campaign;
  const scheduledCount = results.filter(
    (r) => r.itemStatus === 'scheduled' || r.itemStatus === 'pending',
  ).length;
  const sentCount = results.filter((r) => r.itemStatus === 'sent').length;

  return { id: sequenceId, campaign, scheduledCount, sentCount };
}

export async function getActiveFollowups() {
  const results = await db
    .select({
      sequenceId: sequences.id,
      campaign: sequences.campaign,
      createdAt: sequences.createdAt,
      contactEmail: sequenceItems.contactEmail,
      subject: sequenceItems.subject,
      stepNumber: sequenceItems.stepNumber,
      scheduledAt: sequenceItems.scheduledAt,
      itemStatus: sequenceItems.status,
    })
    .from(sequences)
    .innerJoin(sequenceItems, eq(sequenceItems.sequenceId, sequences.id))
    .where(eq(sequences.status, 'active'))
    .orderBy(desc(sequences.createdAt), sequenceItems.stepNumber);

  const grouped = new Map<
    number,
    {
      id: number;
      contactEmail: string;
      subject: string | null;
      createdAt: Date | null;
      totalSteps: number;
      sentSteps: number;
      scheduledSteps: number;
      nextScheduledAt: Date | null;
    }
  >();

  for (const row of results) {
    if (!grouped.has(row.sequenceId)) {
      grouped.set(row.sequenceId, {
        id: row.sequenceId,
        contactEmail: row.contactEmail,
        subject: row.subject,
        createdAt: row.createdAt,
        totalSteps: 0,
        sentSteps: 0,
        scheduledSteps: 0,
        nextScheduledAt: null,
      });
    }
    const seq = grouped.get(row.sequenceId)!;
    seq.totalSteps++;
    if (row.itemStatus === 'sent') seq.sentSteps++;
    if (row.itemStatus === 'scheduled' || row.itemStatus === 'pending') {
      seq.scheduledSteps++;
      if (!seq.nextScheduledAt || row.scheduledAt < seq.nextScheduledAt) {
        seq.nextScheduledAt = row.scheduledAt;
      }
    }
  }

  return Array.from(grouped.values()).filter((s) => s.scheduledSteps > 0);
}
