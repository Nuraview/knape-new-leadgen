/**
 * The seeded outreach dataset behind VITE_DEMO_DATA.
 *
 * WHAT THIS IS FOR. Showing the outreach surfaces — Home's send volume and
 * engagement tiles, and Communications' Sent log — with something in them, for
 * a walkthrough or a screenshot, on an instance where sending has not been
 * switched on yet (apps/leadgen/.env: OUTREACH_SEND_ENABLED=false).
 *
 * WHAT IT IS NOT. A record of anything. Every figure below is invented to a
 * brief, the companies are fictional, and no message here was ever sent to
 * anybody. It is reachable only from a build made with VITE_DEMO_DATA=true,
 * and such a build always carries the banner that says so. See ./enabled.
 *
 * THE BRIEF, kept literally so the numbers can be checked against it:
 *   - first contacts: 50 today, 50 yesterday, 30 and 30 the two days before
 *   - follow-ups: the previous day's first contacts, chased the next day
 *   - 48% opened, 0% clicked, 4% bounced
 *   - a Sent log holding every one of those first contacts
 *
 * DETERMINISTIC ON PURPOSE. A seeded PRNG rather than Math.random, so the same
 * row is the same row across a reload, a re-render and a second screenshot.
 * Numbers that shuffle while someone is being shown them read as a bug, and
 * two screenshots of "the same" list that disagree are worse than either.
 */
import type {
  DailySends,
  EmailStats,
  EmailStatsWindow,
  SentRow,
} from "@/fetchers/leadgen/emails";

/* ── the brief, as constants ────────────────────────────────────────────── */

/** Newest first: today, yesterday, then the two days before. */
const FIRST_CONTACTS_BY_DAY = [50, 50, 30, 30] as const;

const OPEN_RATE_PCT = 48;
/** Zero, and not a rounding of something small: nothing here has a click. */
const CLICK_RATE_PCT = 0;
const BOUNCE_RATE_PCT = 4;

const SENT_TOTAL = FIRST_CONTACTS_BY_DAY.reduce((a, b) => a + b, 0); // 160

/**
 * Follow-ups land the day AFTER the first contact, which is what the brief
 * means by "the total number of emails for which it had to be sent the next
 * day". So the follow-ups going out today are yesterday's first contacts, and
 * the oldest day in the window has no preceding day to be chased from.
 */
const FOLLOWUPS_BY_DAY = FIRST_CONTACTS_BY_DAY.map(
  (_, i) => FIRST_CONTACTS_BY_DAY[i + 1] ?? 0,
); // [50, 30, 30, 0]

const OPENED_TOTAL = Math.round((SENT_TOTAL * OPEN_RATE_PCT) / 100); // 77
const BOUNCED_TOTAL = Math.round((SENT_TOTAL * BOUNCE_RATE_PCT) / 100); // 6
const CLICKED_TOTAL = 0;
const DELIVERED_TOTAL = SENT_TOTAL - BOUNCED_TOTAL; // 154

/* ── deterministic randomness ───────────────────────────────────────────── */

/** mulberry32. Small, seedable, and good enough to scatter a list. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── fictional recipients ───────────────────────────────────────────────── */

/*
 * Invented names, assembled from a place word and a trade word. Deliberately
 * generated rather than listed: a hand-written list of "plausible" company
 * names is how a real firm ends up in demo data, and this dataset is shown to
 * people who work in the industry it is imitating.
 */
const PLACES = [
  "Riverside", "Northgate", "Fairmont", "Cedar Park", "Lakeview", "Westbrook",
  "Summit", "Ironbridge", "Clearwater", "Highland", "Ashford", "Brookfield",
  "Stonegate", "Eastvale", "Redmont", "Wellspring", "Kingsford", "Maple Ridge",
  "Silverton", "Harbourview",
];

const TRADES = [
  "Mechanical", "Construction Group", "Facilities", "Building Services",
  "Contracting", "Developments", "Engineering", "Property Group",
  "Infrastructure", "Works",
];

const FIRST_NAMES = [
  "Jordan", "Alex", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Reese",
  "Dana", "Rowan", "Skyler", "Emerson", "Harper", "Marlowe", "Sasha", "Devon",
];

const LAST_NAMES = [
  "Ellery", "Vance", "Harlow", "Okonjo", "Nakamura", "Castellan", "Bright",
  "Delaney", "Ferris", "Moreau", "Ashby", "Kovač", "Lindqvist", "Мarsh",
  "Whitfield", "Rennick",
];

const ROLES = [
  "Project Director", "Facilities Manager", "Operations Lead",
  "Head of Estates", "Procurement Manager", "Site Manager",
  "Maintenance Supervisor", "Capital Projects Manager",
];

/**
 * Angle keys as they exist in apps/leadgen/outreach/messaging_angles.py, so the
 * by-angle breakdown groups by something the real pipeline would also produce
 * rather than by labels invented here.
 */
const ANGLES = [
  "lead_times",
  "commissioning",
  "maintenance_gap",
  "spec_change",
  "budget_cycle",
  "compliance",
] as const;

const SUBJECT_BY_ANGLE: Record<string, (company: string) => string> = {
  lead_times: (c) => `${c}, the date, not the price`,
  commissioning: (c) => `${c} — commissioning dates`,
  maintenance_gap: (c) => `the gap after handover at ${c}`,
  spec_change: (c) => `a spec question on ${c}`,
  budget_cycle: (c) => `${c} and the next budget cycle`,
  compliance: (c) => `${c}: the inspection, not the paperwork`,
};

const MAILBOXES = ["peter@knapesolutions.com"];

/* ── the rows ───────────────────────────────────────────────────────────── */

export type DemoSentRow = SentRow & { _body: string };

const DAY_MS = 86_400_000;

/**
 * Build every first contact in the window, newest first.
 *
 * Opens and bounces are assigned by POSITION in the shuffled order rather than
 * per-row probability, so the totals come out at exactly the brief's 48% and
 * 4% instead of near them. A demo whose headline tile says 48% and whose list
 * adds up to 51% invites precisely the question the demo is meant to answer.
 */
function buildRows(): DemoSentRow[] {
  const rand = rng(20260918);
  const rows: DemoSentRow[] = [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let id = 4200;

  FIRST_CONTACTS_BY_DAY.forEach((count, dayOffset) => {
    for (let i = 0; i < count; i += 1) {
      const company = `${PLACES[Math.floor(rand() * PLACES.length)]} ${
        TRADES[Math.floor(rand() * TRADES.length)]
      }`;
      const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const role = ROLES[Math.floor(rand() * ROLES.length)];
      const angle = ANGLES[Math.floor(rand() * ANGLES.length)];

      // Spread across the working day rather than clustering at midnight: a
      // column of identical 00:0x timestamps is the first thing that gives a
      // fabricated list away, and the send window is a real constraint here.
      const hour = 8 + Math.floor(rand() * 9);
      const minute = Math.floor(rand() * 60);
      const sentAt =
        startOfToday.getTime() - dayOffset * DAY_MS + hour * 3_600_000 + minute * 60_000;

      const domain = `${company.split(" ")[0].toLowerCase()}.example`;
      const toEmail = `${first.toLowerCase()}@${domain}`;

      rows.push({
        id: id++,
        sequence_id: id,
        step_index: 0,
        sequence_status: "sent",
        sent_at: Math.floor(sentAt / 1000),
        subject: (SUBJECT_BY_ANGLE[angle] ?? ((c: string) => c))(company),
        company,
        to_email: toEmail,
        person_name: `${first} ${last}`,
        from_email: MAILBOXES[0],
        angle,
        open_count: 0,
        first_open_at: null,
        // Never anything but zero. The brief says 0% clicked, and a single
        // stray click would contradict the tile beside it.
        click_count: 0,
        bounced: 0,
        _body: plainBody({ first, company, role, angle }),
      });
    }
  });

  // Deal out opens and bounces over a fixed shuffle.
  const order = rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (let n = 0; n < BOUNCED_TOTAL; n += 1) {
    const row = rows[order[n]];
    row.bounced = 1;
    row.sequence_status = "bounced";
  }

  // Opens come from the rows that did NOT bounce — a bounced message was never
  // delivered, so it cannot have been read, and a list showing otherwise is
  // the kind of detail that makes the whole screen untrustworthy.
  let opened = 0;
  for (let n = BOUNCED_TOTAL; n < order.length && opened < OPENED_TOTAL; n += 1) {
    const row = rows[order[n]];
    row.open_count = 1 + Math.floor(rand() * 3);
    row.first_open_at = (row.sent_at ?? 0) + 600 + Math.floor(rand() * 72_000);
    opened += 1;
  }

  return rows;
}

/**
 * The plain-text body, in the format the pipeline now actually sends: the
 * angle's copy, then the name, the company and the reply address. Mirrors
 * email_sender._append_plain_signature so the demo shows the real shape rather
 * than the retired HTML frames.
 */
function plainBody({
  first,
  company,
  role,
  angle,
}: {
  first: string;
  company: string;
  role: string;
  angle: string;
}): string {
  const opener: Record<string, string> = {
    lead_times:
      "On any project with a commissioning date, the equipment that arrives late costs more than the equipment that cost more.",
    commissioning:
      "Most of the overruns we get called into are not install problems. They are commissioning problems that were visible months earlier.",
    maintenance_gap:
      "The months just after handover are where the maintenance cover tends to be thinnest, and where the first failures land.",
    spec_change:
      "A spec change late in a programme is usually cheaper to absorb than the delay it is trying to avoid.",
    budget_cycle:
      "The plant that fails first is rarely the plant in this year's budget.",
    compliance:
      "An inspection is a date, not a document. The paperwork follows whatever the plant is actually doing.",
  };

  const ask: Record<string, string> = {
    lead_times: `Is there a date at ${company} that this matters to?`,
    commissioning: `Where is ${company} in that sequence?`,
    maintenance_gap: `Is that on someone's desk at ${company} yet?`,
    spec_change: `Is there a project at ${company} where that is live?`,
    budget_cycle: `Is that a conversation ${company} is having yet?`,
    compliance: `Worth a short call while it is still open?`,
  };

  return [
    `Hi ${first},`,
    "",
    opener[angle] ?? opener.lead_times,
    "",
    `I saw you are looking after this as ${role} at ${company}.`,
    "",
    "We handle the mechanical side on work of that size, usually brought in when the programme is already tight. We are straight about what is available and what is not, including when the answer is that we are the wrong people for it.",
    "",
    ask[angle] ?? ask.lead_times,
    "",
    "Peter Wuensch",
    "",
    "Knape & Associates",
    "peter@knapesolutions.com",
  ].join("\n");
}

/** Built once. The dataset is fixed, so rebuilding it per call buys nothing. */
let cached: DemoSentRow[] | null = null;

export function demoSentRows(): DemoSentRow[] {
  if (!cached) cached = buildRows();
  return cached;
}

/* ── the aggregates the dashboard reads ─────────────────────────────────── */

function isoDay(offset: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setTime(d.getTime() - offset * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export function demoDailySends(): DailySends {
  return {
    timezone: "America/New_York",
    timezone_label: "US Eastern",
    // Oldest first, which is the order a bar chart reads in.
    days: FIRST_CONTACTS_BY_DAY.map((sent, i) => ({
      date: isoDay(i),
      sent,
      followups: FOLLOWUPS_BY_DAY[i],
      bounced: 0,
    }))
      .slice()
      .reverse(),
    today: FIRST_CONTACTS_BY_DAY[0],
    yesterday: FIRST_CONTACTS_BY_DAY[1],
    followups_today: FOLLOWUPS_BY_DAY[0],
    followups_yesterday: FOLLOWUPS_BY_DAY[1],
    followups_total: FOLLOWUPS_BY_DAY.reduce((a, b) => a + b, 0),
    sent_total: SENT_TOTAL,
  };
}

function window_(): EmailStatsWindow {
  const followups = FOLLOWUPS_BY_DAY.reduce((a, b) => a + b, 0);
  return {
    // `sent` is first contacts only — the type is explicit that a follow-up is
    // not a new email — so this is also the count of NEW COMPANIES EMAILED,
    // one first contact per fictional company.
    sent: SENT_TOTAL,
    people: SENT_TOTAL,
    followups,
    messages: SENT_TOTAL + followups,
    delivered: DELIVERED_TOTAL,
    bounced: BOUNCED_TOTAL,
    opened: OPENED_TOTAL,
    clicked: CLICKED_TOTAL,
    open_rate: OPEN_RATE_PCT,
    click_rate: CLICK_RATE_PCT,
    bounce_rate: BOUNCE_RATE_PCT,
    delivered_rate: Math.round((DELIVERED_TOTAL / SENT_TOTAL) * 1000) / 10,
    ctr_of_opens: 0,
  };
}

export function demoEmailStats(days = 7): EmailStats {
  const rows = demoSentRows();

  const byAngle = ANGLES.map((angle) => {
    const mine = rows.filter((r) => r.angle === angle);
    const opened = mine.filter((r) => (r.open_count ?? 0) > 0).length;
    return {
      angle,
      sent: mine.length,
      opened,
      clicked: 0,
      open_rate: mine.length
        ? Math.round((opened / mine.length) * 1000) / 10
        : 0,
      click_rate: 0,
    };
  }).filter((a) => a.sent > 0);

  const w = window_();

  return {
    days,
    window: w,
    overall: w,
    by_angle: byAngle,
    daily: demoDailySends(),
    capacity: {
      mailboxes: MAILBOXES.map((email) => ({
        email,
        daily_cap: 60,
        used_24h: FIRST_CONTACTS_BY_DAY[0],
        remaining: 60 - FIRST_CONTACTS_BY_DAY[0],
      })),
      capacity: 60,
      used_24h: FIRST_CONTACTS_BY_DAY[0],
      remaining: 60 - FIRST_CONTACTS_BY_DAY[0],
    },
    headroom: {
      window_open: true,
      opens_at: "08:00",
      closes_at: "17:00",
      capacity_left: 60 - FIRST_CONTACTS_BY_DAY[0],
      fresh_contacts: 214,
      can_send_now: 10,
      limited_by: "mailbox capacity",
      sentence:
        "10 more first emails can go out today — the mailbox cap is the limit, not the contact list.",
    },
    scanner_filtered: 0,
  };
}

/** Who opened / bounced, for Home's engagement tabs. Clicks are always empty. */
export function demoEngagement(kind: string): {
  kind: string;
  items: Record<string, unknown>[];
} {
  const rows = demoSentRows();

  const pick =
    kind === "opened"
      ? rows.filter((r) => (r.open_count ?? 0) > 0)
      : kind === "bounced"
        ? rows.filter((r) => r.bounced === 1)
        : // "clicked", and anything else: nothing was clicked.
          [];

  return {
    kind,
    /*
     * Keys MUST match email_store.engagement_list, which selects
     * `sq.to_email` and `st.bounce_info`. This mapping used `email` and
     * `reason`, so the dashboard read row.to_email as undefined and printed
     * the literal string "undefined" — with a mailto:undefined link beside
     * it. Demo data that does not have the real data's shape tests the wrong
     * thing and, worse, invents bugs that are not in the product.
     */
    items: pick.slice(0, 100).map((r) => ({
      id: r.id,
      company: r.company,
      person_name: r.person_name,
      to_email: r.to_email,
      subject: r.subject,
      angle: r.angle,
      sent_at: r.sent_at,
      first_open_at: r.first_open_at,
      open_count: r.open_count,
      click_at: null,
      click_count: 0,
      bounce_at: r.bounced ? r.sent_at : null,
      bounce_info: r.bounced
        ? "550 5.1.1 recipient address rejected: user unknown"
        : null,
    })),
  };
}

/** One page of the Sent log. */
export function demoRecent(offset = 0, limit = 100) {
  const rows = demoSentRows();
  return {
    items: rows.slice(offset, offset + limit).map(({ _body, ...row }) => row),
    total: rows.length,
    limit,
    offset,
  };
}

/** The reader dialog: one sent email, as plain text. */
export function demoStep(stepId: number) {
  const row = demoSentRows().find((r) => r.id === stepId) ?? demoSentRows()[0];
  return {
    id: row.id,
    sequence_id: row.sequence_id,
    step_index: row.step_index,
    subject: row.subject,
    to_email: row.to_email,
    from_email: row.from_email,
    company: row.company,
    person_name: row.person_name,
    angle: row.angle,
    sent_at: row.sent_at,
    open_count: row.open_count,
    first_open_at: row.first_open_at,
    click_count: 0,
    bounced: row.bounced,
    body: row._body,
    // No HTML: the pipeline sends one text/plain part now. Returning a
    // rendered frame here would show a format that is no longer sent.
    html: "",
  };
}

/** Bounces, for the Communications bounce tab. */
export function demoBounced() {
  const items = demoSentRows()
    .filter((r) => r.bounced === 1)
    .map((r) => ({
      id: r.id,
      // to_email / bounce_info, as the cockpit names them. See the note above.
      to_email: r.to_email,
      company: r.company,
      person_name: r.person_name,
      subject: r.subject,
      sent_at: r.sent_at,
      bounce_at: r.sent_at,
      bounce_info: "550 5.1.1 recipient address rejected: user unknown",
    }));
  return { items, total: items.length };
}
