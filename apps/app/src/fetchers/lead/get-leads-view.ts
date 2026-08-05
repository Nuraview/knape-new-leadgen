import { getApiUrl } from "../get-api-url";

export type Lead = {
  id: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  description: string | null;
  linkedinUrl: string | null;
  upworkJobUrl: string | null;
  createdAt: string | null;
  postedAt: string | null;
  extractedAt: string | null;
  highlightedAt: string | null;
  lastContactedAt: string | null;
  reminderAt: string | null;
  reminderNote: string | null;
  reminderSentAt: string | null;
  reminderFirstSentAt: string | null;
  irrelevantAt: string | null;
  irrelevantReason: string | null;
  leadStatusId: string | null;
  statusName: string | null;
  hasClientInfo: boolean | null;
  clientLocation: string | null;
  hasJobHistory: boolean | null;
  /**
   * Only the budget keys, not the real source_payload — the API projects
   * budget_raw/budget_min/budget_max out of it so the Kanban card can show a
   * budget without shipping multi-KB of scrape payload per card.
   */
  sourcePayload: {
    budget_raw: string | null;
    budget_min: string | null;
    budget_max: string | null;
  } | null;
  /**
   * When THIS user last opened the lead — the 👁 on the row and the card.
   * Null means never opened by me, which is the "what's new since last time"
   * signal the team scans by.
   */
  viewedAt: string | null;
};

export type LeadStatus = { id: string; name: string | null };

export type LeadsView = {
  items: Lead[];
  total: number;
  /** Ingested in the last 24h — the count the team watches tick up. */
  addedRecently: number;
  limit: number;
  offset: number;
  statuses: LeadStatus[];
};

export type LeadsQuery = {
  q?: string;
  view?: "active" | "irrelevant";
  companiesOnly?: boolean;
  highlighted?: "all" | "yes" | "no";
  clientInfo?: "all" | "rich" | "missing";
  remindersOnly?: boolean;
  statusId?: string;
  limit?: number;
  offset?: number;
  /** Restrict to leads scraped within the last N days (Kanban day columns). */
  days?: number;
  /**
   * Explicit arrival window, half-open [from, to). One Kanban column queries
   * one day. Fetching the whole window in a single request and bucketing in
   * the browser does not work: the page size caps at 100 and one day can hold
   * several hundred leads, so every column after the first came back empty.
   */
  from?: string;
  to?: string;
  /** "yes" = the Taken care column, "no" = the day columns. */
  contacted?: "yes" | "no";
  /**
   * Server-side now. These were applied in the browser over the fetched page
   * while the header showed the unfiltered total — 366 above three cards.
   */
  hasEmail?: boolean;
  country?: string;
};

/**
 * Mirrors the legacy /api/leads contract so the team's filters behave exactly
 * as they do today — the migration changes the look, not the flow.
 */
export async function getLeadsView(query: LeadsQuery = {}): Promise<LeadsView> {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.view) p.set("view", query.view);
  if (query.companiesOnly) p.set("companies_only", "1");
  if (query.highlighted && query.highlighted !== "all")
    p.set("highlighted", query.highlighted);
  if (query.clientInfo && query.clientInfo !== "all")
    p.set("client_info", query.clientInfo);
  if (query.remindersOnly) p.set("reminders", "1");
  if (query.statusId) p.set("status_id", query.statusId);
  if (query.limit) p.set("limit", String(query.limit));
  if (query.offset) p.set("offset", String(query.offset));
  if (query.days) p.set("days", String(query.days));
  if (query.from) p.set("from", query.from);
  if (query.to) p.set("to", query.to);
  if (query.contacted) p.set("contacted", query.contacted);
  if (query.hasEmail) p.set("has_email", "1");
  if (query.country) p.set("country", query.country);

  const response = await fetch(`${getApiUrl("lead/view")}?${p.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to load leads (${response.status})`);
  }

  return response.json();
}
