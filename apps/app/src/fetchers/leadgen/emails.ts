import { leadgen } from "./client";

/**
 * The outreach surface of the lead-gen cockpit, reached through the CRM's own
 * proxy. Shapes mirror what the Python API actually returns — see
 * outreach/email_store.py and outreach/campaign_sender.py.
 */

export type EmailStatsWindow = {
  /**
   * NEW PEOPLE: distinct recipients who got a first email in this window.
   * This is the only number allowed to be labelled "emails sent" — a
   * follow-up is not a new email, it is the same conversation continued, and
   * counting them together let a day of pure chasing read as prospecting.
   */
  sent: number;
  people?: number;
  /** Follow-ups in the window. Never added into `sent`. */
  followups?: number;
  /** Everything that left, first contacts and follow-ups. Rates divide by this. */
  messages?: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  delivered_rate: number;
  ctr_of_opens: number;
};

export type AngleStat = {
  angle: string;
  sent: number;
  opened?: number;
  clicked?: number;
  open_rate?: number;
  click_rate?: number;
};

/**
 * Emails that actually left a mailbox, by calendar day in the reader's own
 * timezone. Everything else on this type is a rolling window, which is why
 * "how many did we send yesterday?" used to have no answer on screen.
 */
export type DailySends = {
  timezone: string;
  /** "US Eastern" — shown on screen so the number is not argued about. */
  timezone_label?: string;
  /** `sent` is FIRST contacts only. Follow-ups are counted separately. */
  days: {
    date: string;
    sent: number;
    followups: number;
    bounced: number;
  }[];
  today: number;
  yesterday: number;
  followups_today: number;
  followups_yesterday: number;
  followups_total: number;
  sent_total: number;
};

/** What the mailboxes are allowed to send in a rolling 24h, and what is left. */
export type SendCapacity = {
  mailboxes: {
    email: string;
    daily_cap: number;
    used_24h: number;
    remaining: number;
  }[];
  capacity: number;
  used_24h: number;
  remaining: number;
};

/**
 * How many first emails can actually go out, and what is stopping the rest.
 * Composed server-side so the wording can never drift from the numbers.
 */
export type SendHeadroom = {
  window_open: boolean;
  opens_at: string;
  closes_at: string;
  capacity_left: number;
  fresh_contacts: number;
  can_send_now: number;
  limited_by: "sending hours" | "fresh contacts" | "mailbox capacity" | string;
  sentence: string;
};

export type EmailStats = {
  days: number;
  window: EmailStatsWindow;
  overall: EmailStatsWindow;
  by_angle?: AngleStat[];
  daily?: DailySends | null;
  capacity?: SendCapacity | null;
  headroom?: SendHeadroom | null;
  /**
   * Opens and clicks attributed to security scanners (Proofpoint, Mimecast,
   * Safe Links) and excluded from the counters above. Surfaced rather than
   * hidden: without it the open rate looks better than it is, and this pipeline
   * targets school districts, which are heavily scanned.
   */
  scanner_filtered?: number;
};

/**
 * One step of a sequence. `scheduled_at` is what makes this a FOLLOW-UP queue
 * rather than a list: step 0 goes on send, the rest are timed by
 * MILESTONE2_FOLLOWUP_GAP_DAYS (3,5,7) and drained by the scheduler.
 */
export type SentRow = {
  /** email_steps.id — this is what the reader dialog takes. */
  id: number;
  /** email_sequences.id — what stop-follow-ups and remove take. */
  sequence_id: number;
  step_index?: number;
  sequence_status?: string;
  sent_at?: number | null;
  subject?: string;
  company?: string;
  to_email?: string;
  person_name?: string;
  from_email?: string;
  angle?: string;
  open_count?: number;
  first_open_at?: number | null;
  click_count?: number;
  bounced?: number;
};

export type SequenceStep = {
  id?: number;
  step_index?: number;
  subject?: string;
  body?: string;
  status?: string;
  scheduled_at?: number | null;
  sent_at?: number | null;
  delay_after_prev_days?: number | null;
};

/** A sequence sitting in the approved queue, with its follow-up schedule. */
export type ApprovedSequence = {
  id: number;
  company?: string;
  person_name?: string;
  to_email: string;
  from_email?: string;
  angle?: string;
  status?: string;
  created_at?: number;
  updated_at?: number;
  steps?: SequenceStep[];
};

/** Queue plus the rolling-24h send budget, from GET /api/emails/approved. */
export type ApprovedQueue = {
  items?: ApprovedSequence[];
  cap_remaining?: number;
};

export type CampaignStatus = {
  status: "idle" | "running" | "stopped" | "done" | string;
  /** Generating drafts, or sending them. Reported separately so a half-done
   *  generate cannot be read as a half-done send. */
  phase?: "idle" | "generating" | "sending";
  /** Sequences drafted so far this run, against generate_total. */
  generated?: number;
  generate_total?: number;
  config: {
    total?: number;
    batch_size?: number;
    interval_minutes?: number;
    angle?: string | null;
  } | null;
  sent: number;
  failed: number;
  bounced: number;
  valid: number;
  invalid: number;
  batch: number;
  batches_total: number;
  next_batch_at: number | null;
  started_at: number | null;
  last_send_at: number | null;
  message: string;
  validating: boolean;
  /** Never-emailed accounts with a validated address — the sendable pool. */
  pool_remaining: number;
  /** Sends still allowed in the rolling 24h window. Drafting is NOT capped;
   *  only sending is, so this bounds the send step and not the generate one. */
  cap_remaining?: number;
  validation?: { valid: number; invalid: number };
  funnel?: {
    total: number;
    with_email: number;
    emailed: number;
    no_email: number;
  };
};

export const leadgenEmails = {
  /**
   * No `tz`. The per-day counts are bucketed in US Eastern server-side, on
   * purpose: this dashboard is read from India, and sending the browser's zone
   * put a 6am IST scrape into "today" when it was still the previous evening
   * where the schools are. One fixed zone means "yesterday" is the same 24
   * hours for everyone looking at it.
   */
  stats: (days = 7) => leadgen.get<EmailStats>("/api/emails/stats", { days }),

  approved: () => leadgen.get<ApprovedQueue>("/api/emails/approved"),

  /**
   * Fires the approved queue as one batch.
   *
   * Takes a subset so the review step can drop a few and send the rest —
   * without ids it sends everything approved, which is the old behaviour.
   */
  sendApproved: (sequenceIds?: number[]) =>
    leadgen.post<{ result: { queued: number }; detail?: string }>(
      "/api/emails/send-approved",
      sequenceIds?.length ? { sequence_ids: sequenceIds } : {},
    ),

  campaignStatus: () =>
    leadgen.get<CampaignStatus>("/api/emails/campaign/status"),

  /** Syntax + MX + SMTP RCPT probe over the never-emailed pool. */
  campaignValidate: () =>
    leadgen.post<unknown>("/api/emails/campaign/validate"),

  /** Draft a whole run for review. Sends nothing. */
  campaignGenerate: (input: { total: number; angle?: string | null }) =>
    leadgen.post<CampaignStatus>("/api/emails/campaign/generate", input),

  campaignStart: (input: {
    total: number;
    batch_size: number;
    interval_minutes: number;
    angle?: string | null;
  }) => leadgen.post<unknown>("/api/emails/campaign/start", input),

  campaignStop: () => leadgen.post<unknown>("/api/emails/campaign/stop"),

  /** Follow-ups still to go out, soonest first. */
  scheduled: (days = 30) =>
    leadgen.get<ScheduledResponse>("/api/emails/scheduled", { days }),
};

/** One pending follow-up, from GET /api/emails/scheduled. */
export type ScheduledStep = {
  id: number;
  sequence_id: number;
  step_index: number;
  subject?: string;
  scheduled_at: number;
  delay_after_prev_days?: number | null;
  to_email: string;
  company?: string;
  person_name?: string;
  from_email?: string;
  angle?: string;
  sequence_status?: string;
};

export type ScheduledResponse = {
  items: ScheduledStep[];
  summary: { steps: number; sequences: number };
  days: number;
};

/* ---------------------------------------------------------------------------
 * Surfaces the first port missed.
 *
 * Every one of these already existed in the cockpit and was reachable through
 * the proxy — the UI simply never called them. Grouped here so the gap between
 * "the API is proxied" and "the feature is ported" stays visible.
 * ------------------------------------------------------------------------- */

/** What the recipient will actually see: copy rendered through the production
 *  template, including the per-angle designed creative. */
export type EmailPreview = {
  html: string;
  /** Which design was drawn. */
  variant?: string;
  /** Which design is actually being sent, from the dashboard setting. */
  live_variant?: string;
};

/** One sent email in full, with engagement. */
export type SentEmailDetail = {
  id: number;
  step_index?: number;
  subject?: string;
  body?: string;
  html?: string;
  sent_at?: number;
  status?: string;
  open_count?: number;
  first_open_at?: number | null;
  click_count?: number;
  click_at?: number | null;
  bounced?: number;
  bounce_info?: string | null;
  company?: string;
  person_name?: string;
  to_email?: string;
  from_email?: string;
  angle?: string;
  account_id?: number;
};

export type EngagementKind = "opened" | "clicked" | "bounced";

export const leadgenEmailExtras = {
  /** Render copy exactly as it will send. */
  /**
   * Render copy through the production template.
   *
   * `variant` overrides which of the two approved designs is drawn — frame1
   * (photo header, left-aligned) or frame2 (flat dark header, centred). Omit it
   * to render whatever is actually being sent.
   */
  preview: (input: {
    body: string;
    from_email?: string;
    angle?: string;
    step_index?: number;
    variant?: string;
  }) => leadgen.post<EmailPreview>("/api/emails/preview", input),

  /** One sent email, with the HTML the recipient received. */
  step: (stepId: number) =>
    leadgen.get<SentEmailDetail>(`/api/emails/step/${stepId}`),

  /** Who opened / clicked / bounced. */
  engagement: (kind: EngagementKind) =>
    leadgen.get<{ kind: string; items: Record<string, unknown>[] }>(
      "/api/emails/engagement",
      { kind },
    ),

  /**
   * Paginated sent log.
   *
   * /sent returns a capped snapshot; this is the one that walks all 800-odd
   * sends. It takes limit+offset — it was being called with `page`, which the
   * endpoint ignores, so every "next page" quietly returned page one.
   */
  recent: (offset = 0, limit = 100) =>
    leadgen.get<{
      items: SentRow[];
      total?: number;
      limit?: number;
      offset?: number;
    }>("/api/emails/recent", { limit, offset }),

  /** Manual one-off send, tracked like any other. */
  compose: (input: { to_email: string; subject: string; body: string }) =>
    leadgen.post<unknown>("/api/emails/compose", input),

  /** Cancel the pending follow-ups on a sequence, keeping what already sent. */
  stopSequence: (id: number) =>
    leadgen.post<unknown>(`/api/emails/sequences/${id}/stop`),

  /** Pull an approved sequence back to draft before it goes out. */
  unapprove: (id: number) =>
    leadgen.post<unknown>(`/api/emails/sequences/${id}/unapprove`),

  /** Remove a sequence from the Sent log. */
  deleteSequence: (id: number) =>
    leadgen.del<unknown>(`/api/emails/sequences/${id}`),
};
