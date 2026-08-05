import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  crmCampaignSends,
  crmCampaignSteps,
  crmCampaigns,
} from "@/drizzle/schema";

export type EngagementStatus =
  | "none"
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced";

export interface LeadEngagementSummary {
  totalSends: number;
  lastSentAt: string | null;
  latestStatus: EngagementStatus;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
}

export interface LeadEngagementEvent {
  id: string;
  campaignName: string | null;
  subject: string | null;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  errorMessage: string | null;
}

const EMPTY_SUMMARY: LeadEngagementSummary = {
  totalSends: 0,
  lastSentAt: null,
  latestStatus: "none",
  openedCount: 0,
  clickedCount: 0,
  bouncedCount: 0,
};

// Best-signal ordering for the per-lead badge. Higher = more interesting to the
// reviewer triaging callbacks — clicks beat opens, opens beat bounces, etc.
function rankStatus(s: EngagementStatus): number {
  switch (s) {
    case "clicked":
      return 5;
    case "opened":
      return 4;
    case "bounced":
      return 3;
    case "delivered":
      return 2;
    case "sent":
      return 1;
    case "queued":
      return 0;
    default:
      return -1;
  }
}

type SendRow = {
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
};

function reduceSummary(rows: SendRow[]): LeadEngagementSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;

  let best: EngagementStatus = "none";
  let lastSent: string | null = null;
  let opened = 0;
  let clicked = 0;
  let bounced = 0;

  for (const r of rows) {
    if (r.sentAt && (!lastSent || r.sentAt > lastSent)) lastSent = r.sentAt;
    if (r.openedAt) opened++;
    if (r.clickedAt) clicked++;
    if (r.status === "bounced") bounced++;

    let signal: EngagementStatus;
    if (r.clickedAt) signal = "clicked";
    else if (r.openedAt) signal = "opened";
    else if (r.status === "bounced") signal = "bounced";
    else if (r.status === "delivered") signal = "delivered";
    else if (r.status === "sent") signal = "sent";
    else signal = "queued";

    if (rankStatus(signal) > rankStatus(best)) best = signal;
  }

  return {
    totalSends: rows.length,
    lastSentAt: lastSent,
    latestStatus: best === "none" ? "queued" : best,
    openedCount: opened,
    clickedCount: clicked,
    bouncedCount: bounced,
  };
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getLeadsEngagementSummary(
  emails: (string | null | undefined)[],
): Promise<Map<string, LeadEngagementSummary>> {
  const result = new Map<string, LeadEngagementSummary>();

  const normalized = Array.from(
    new Set(emails.map(normalizeEmail).filter((e): e is string => e !== null)),
  );
  if (normalized.length === 0) return result;

  const rows = await db
    .select({
      email: sql<string>`lower(${crmCampaignSends.email})`,
      status: crmCampaignSends.status,
      sentAt: crmCampaignSends.sentAt,
      openedAt: crmCampaignSends.openedAt,
      clickedAt: crmCampaignSends.clickedAt,
    })
    .from(crmCampaignSends)
    .where(inArray(sql`lower(${crmCampaignSends.email})`, normalized));

  const grouped = new Map<string, SendRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.email) ?? [];
    arr.push({
      status: r.status,
      sentAt: r.sentAt,
      openedAt: r.openedAt,
      clickedAt: r.clickedAt,
    });
    grouped.set(r.email, arr);
  }

  grouped.forEach((group, email) => {
    result.set(email, reduceSummary(group));
  });

  return result;
}

export async function getLeadEngagementTimeline(
  email: string | null | undefined,
): Promise<LeadEngagementEvent[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const rows = await db
    .select({
      id: crmCampaignSends.id,
      status: crmCampaignSends.status,
      sentAt: crmCampaignSends.sentAt,
      openedAt: crmCampaignSends.openedAt,
      clickedAt: crmCampaignSends.clickedAt,
      errorMessage: crmCampaignSends.errorMessage,
      subject: crmCampaignSteps.subject,
      campaignName: crmCampaigns.name,
    })
    .from(crmCampaignSends)
    .leftJoin(
      crmCampaignSteps,
      eq(crmCampaignSteps.id, crmCampaignSends.stepId),
    )
    .leftJoin(crmCampaigns, eq(crmCampaigns.id, crmCampaignSends.campaignId))
    .where(eq(sql`lower(${crmCampaignSends.email})`, normalized))
    .orderBy(desc(crmCampaignSends.sentAt));

  return rows;
}
