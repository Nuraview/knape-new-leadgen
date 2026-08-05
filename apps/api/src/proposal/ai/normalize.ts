/**
 * Turn what the model returned into something safe to store and show a client.
 *
 * THE MODEL PROPOSES, THIS FILE DECIDES. Everything here runs after the LLM and
 * before the database. Nothing the model writes reaches a proposal unchecked:
 * prices are re-derived against a budget band, HTML goes through the same
 * allow-list sanitizer the public page relies on, section keys and ordering are
 * re-assigned server-side, and the pricing table is rebuilt from the clamped
 * line items so the table a client reads can never disagree with what they are
 * charged.
 *
 * Kept free of database and network calls so it can be unit-tested directly —
 * the pricing rules are the part that costs money when they are wrong.
 */
import { sanitizeProposalHtml } from "../lib/sanitize-html";

/* ------------------------------------------------------------------ */
/*  Tuning constants                                                   */
/* ------------------------------------------------------------------ */

/**
 * How far either side of a single posted budget figure we allow the total to
 * land.
 *
 * An Upwork budget is an anchor the buyer typed before scoping the work, not a
 * ceiling — the team routinely closes above it, and occasionally trims below
 * when the real scope is smaller than the posting implied. Named rather than
 * inlined because these are the numbers to tune when the drafts read as
 * consistently over- or under-priced.
 */
export const FIXED_BUDGET_FLOOR_MULTIPLIER = 0.85;
export const FIXED_BUDGET_CEILING_MULTIPLIER = 1.6;

/**
 * Same idea, applied to the median of past won proposals — but far wider.
 *
 * A posted budget is this buyer telling you what they will pay for this job.
 * The price book is the middle of a handful of unrelated jobs, and a two-week
 * finance model has no reason to cost what a brochure did. The old 0.7–1.4
 * window treated the two as equally authoritative and clamped a $1,500 piece
 * of work down to $148. Wide enough here to catch an order-of-magnitude error
 * and nothing finer.
 */
export const PRICE_BOOK_FLOOR_MULTIPLIER = 0.5;
export const PRICE_BOOK_CEILING_MULTIPLIER = 1.5;

export const MAX_LINE_ITEMS = 12;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 90;
export const DEFAULT_DEPOSIT_PCT = 50;

/**
 * Icons the scope section may use.
 *
 * The editor's picker enumerates every export of lucide-react, but this is the
 * API — it has no lucide dependency and cannot check a name against the real
 * package. A short curated list of icons known to exist is checkable, and an
 * unrecognised name degrades to null, which the editor renders as its Sparkles
 * placeholder. A bad icon name would otherwise render as a blank hole in the
 * document the client opens.
 */
export const ALLOWED_ICONS = [
  "Activity", "AlertCircle", "BarChart3", "Bell", "Bot", "Boxes", "Brush",
  "Calendar", "ChartLine", "CheckCircle2", "Clock", "Code2", "Compass",
  "CreditCard", "Database", "FileSearch", "FileText", "Filter", "Gauge",
  "Globe", "GraduationCap", "Handshake", "Headphones", "Layers", "LayoutGrid",
  "LifeBuoy", "Lightbulb", "LineChart", "Link2", "Lock", "Mail", "MapPin",
  "Megaphone", "MessageSquare", "MonitorSmartphone", "MousePointerClick",
  "Package", "PenTool", "Percent", "PieChart", "Play", "Puzzle", "Rocket",
  "Search", "Settings", "Share2", "ShieldCheck", "ShoppingCart", "Smartphone",
  "Sparkles", "Target", "TrendingUp", "Truck", "Users", "Wand2", "Workflow",
  "Wrench", "Zap",
] as const;

const ICON_SET = new Set<string>(ALLOWED_ICONS);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PriceBand = {
  min: number;
  max: number;
  /** Where the band came from, for the warning text and for tests. */
  source: "posted-range" | "posted-fixed" | "price-book" | "none";
};

export type DraftLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
};

export type DraftSection = {
  key: string;
  type: string;
  title: string;
  bodyHtml: string;
  order: number;
  items?: Array<{
    title: string;
    description: string;
    icon: string | null;
    bullets: string[];
  }>;
  phases?: Array<{ label: string; duration: string }>;
  clientField?: { label: string; unit: "days" | "hours" } | null;
  rows?: Array<{
    item: string;
    type: string;
    amount: string;
    included: boolean;
  }>;
  totalLabel?: string;
  totalAmount?: string;
  totalType?: string;
};

/** The model's raw answer, before any of this file has touched it. */
export type RawDraft = {
  title?: unknown;
  projectName?: unknown;
  clientName?: unknown;
  clientCompany?: unknown;
  publicNotes?: unknown;
  internalNotes?: unknown;
  depositPct?: unknown;
  expiresInDays?: unknown;
  lineItems?: unknown;
  sections?: unknown;
  /** Short callout under the pricing table — the discount or what is included. */
  pricingNote?: unknown;
  /** PROJECT | RETAINER — decides which house terms get attached. */
  engagementKind?: unknown;
};

/**
 * Read the model's classification, defaulting to PROJECT.
 *
 * Defaulting matters: retainer terms on a fixed-price job promise ongoing
 * capacity and a pro-rata refund that nobody is offering, whereas project terms
 * on a retainer merely under-describe it. The safe direction is obvious.
 */
export function engagementKindOf(raw: unknown): "PROJECT" | "RETAINER" {
  return String(raw ?? "").toUpperCase() === "RETAINER" ? "RETAINER" : "PROJECT";
}

export type NormalizedDraft = {
  title: string;
  engagementKind: "PROJECT" | "RETAINER";
  projectName: string;
  clientName: string;
  clientCompany: string;
  publicNotes: string;
  internalNotes: string;
  depositPct: number;
  expiresInDays: number;
  lineItems: DraftLineItem[];
  sections: DraftSection[];
  total: number;
  warnings: string[];
};

/* ------------------------------------------------------------------ */
/*  Number parsing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pull a number out of whatever the scraper stored.
 *
 * budget_min/budget_max arrive as numbers on a good scrape and as strings
 * ("1500", "$1,500.00") on a bad one, and Gemini's "Not Found" sentinel shows
 * up in these fields too.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is this posting billed hourly? An hourly rate is not a project total. */
export function isHourlyBudget(raw: unknown): boolean {
  return typeof raw === "string" && /\/\s*hr|per hour|hourly/i.test(raw);
}

/** Median of a list, ignoring anything that is not a usable positive number. */
export function median(values: number[]): number | null {
  const sorted = values
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  if (sorted.length % 2 !== 0) return upper;
  return ((sorted[mid - 1] as number) + upper) / 2;
}

/* ------------------------------------------------------------------ */
/*  Price band                                                         */
/* ------------------------------------------------------------------ */

/**
 * What total is defensible for this posting?
 *
 * Order of preference: the range the buyer posted, then the single figure they
 * posted, then what comparable work has actually sold for. An hourly posting
 * has no project total at all, so it skips straight to the price book — the
 * alternative is anchoring a fixed-price proposal to somebody's hourly rate,
 * which produces a $45 proposal.
 */
export function resolveBudgetBand(
  sourcePayload: Record<string, unknown> | null | undefined,
  priceBook: { min: number; max: number } | null,
  warnings: string[],
): PriceBand {
  const payload = sourcePayload ?? {};
  const rawBudget = payload.budget_raw;

  /*
   * Built from the cheapest and dearest comparable job, not the middle one.
   * This is a sanity check against an order-of-magnitude mistake, not an
   * opinion about what this particular piece of work is worth.
   */
  const bookBand = (): PriceBand | null => {
    if (!priceBook || priceBook.min <= 0) return null;
    return {
      min: priceBook.min * PRICE_BOOK_FLOOR_MULTIPLIER,
      max: priceBook.max * PRICE_BOOK_CEILING_MULTIPLIER,
      source: "price-book",
    };
  };

  if (isHourlyBudget(rawBudget)) {
    const band = bookBand();
    if (band) {
      warnings.push(
        "Hourly posting — there is no project total to anchor to, so the price was only checked against the range of past won work. Set it yourself.",
      );
      return band;
    }
    warnings.push(
      "Hourly posting and no past won proposals to compare against — the prices below are unverified.",
    );
    return { min: 0, max: Number.POSITIVE_INFINITY, source: "none" };
  }

  const min = toNumber(payload.budget_min);
  const max = toNumber(payload.budget_max);
  if (min && max && max >= min) {
    return { min, max, source: "posted-range" };
  }

  const single = min ?? max ?? toNumber(rawBudget);
  if (single) {
    return {
      min: single * FIXED_BUDGET_FLOOR_MULTIPLIER,
      max: single * FIXED_BUDGET_CEILING_MULTIPLIER,
      source: "posted-fixed",
    };
  }

  const band = bookBand();
  if (band) {
    warnings.push(
      "This posting states no budget, so the price was only checked against the range of past won work. Confirm it before sending.",
    );
    return band;
  }

  warnings.push(
    "No budget on the posting and no past won proposals to compare against — the prices below are unverified.",
  );
  return { min: 0, max: Number.POSITIVE_INFINITY, source: "none" };
}

/* ------------------------------------------------------------------ */
/*  Line items                                                         */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotal(line: DraftLineItem): number {
  return line.quantity * line.unitPrice * (1 - line.discountPercent / 100);
}

export function sumLines(lines: DraftLineItem[]): number {
  return round2(lines.reduce((total, line) => total + lineTotal(line), 0));
}

/** Coerce one model-supplied line into the shape the writer expects. */
function coerceLine(raw: unknown): DraftLineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const description = String(value.description ?? "").trim();
  if (!description) return null;

  const quantity = toNumber(value.quantity) ?? 1;
  const unitPrice = Math.max(0, Number(value.unitPrice) || 0);
  const discountRaw = Number(value.discountPercent) || 0;

  return {
    description: description.slice(0, 500),
    quantity,
    unitPrice: round2(unitPrice),
    discountPercent: Math.min(100, Math.max(0, discountRaw)),
  };
}

/**
 * Bring the line items inside the band.
 *
 * Scaling every unit price by the same factor rather than editing one line
 * keeps the shape of the model's breakdown — the ratio between design and
 * development stays what it argued for, only the magnitude moves. The rounding
 * remainder lands on the largest line, so the stored total is exactly the
 * target rather than a cent or two away from it.
 */
export function clampLineItems(
  lines: DraftLineItem[],
  band: PriceBand,
  warnings: string[],
): DraftLineItem[] {
  if (lines.length === 0) return lines;

  const sum = sumLines(lines);
  if (sum <= 0) {
    warnings.push("The draft came back with no prices — set them by hand.");
    return lines;
  }
  if (band.source === "none") return lines;
  if (sum >= band.min && sum <= band.max) return lines;

  const target = Math.min(Math.max(sum, band.min), band.max);
  const factor = target / sum;

  const scaled = lines.map((line) => ({
    ...line,
    unitPrice: round2(line.unitPrice * factor),
  }));

  // Rounding each line independently drifts off the target by a few cents.
  // Put the difference on the biggest line, where it is proportionally least
  // visible, so subtotal + deposit arithmetic stays exact.
  const drift = round2(target - sumLines(scaled));
  if (drift !== 0) {
    let largest = scaled[0] as DraftLineItem;
    for (const candidate of scaled) {
      if (lineTotal(candidate) > lineTotal(largest)) largest = candidate;
    }
    const divisor = largest.quantity * (1 - largest.discountPercent / 100);
    if (divisor > 0) {
      largest.unitPrice = Math.max(
        0,
        round2(largest.unitPrice + drift / divisor),
      );
    }
  }

  warnings.push(
    `Prices were rescaled from ${sum.toFixed(2)} to ${sumLines(scaled).toFixed(2)} to stay inside the ${band.min.toFixed(0)}–${band.max === Number.POSITIVE_INFINITY ? "∞" : band.max.toFixed(0)} band for this lead.`,
  );

  return scaled;
}

/* ------------------------------------------------------------------ */
/*  Sections                                                           */
/* ------------------------------------------------------------------ */

const SECTION_TYPES = new Set([
  "richtext",
  "scope",
  "timeline",
  "pricing",
  "testimonials",
]);

/**
 * Section titles that are house boilerplate rather than per-deal writing.
 *
 * Matched on the title because that is all the sections carry — there is no
 * flag on the JSON separating "ours" from "this deal's", and adding one would
 * not help the proposals that already exist.
 *
 * Lives here, in the pure module, rather than next to the database code that
 * also needs it: this predicate decides what a language model is allowed to
 * rewrite, so it has to be testable without a database connection.
 */
const BOILERPLATE_TITLE_PATTERNS = [
  /service\s*terms/i,
  /payment\s*terms/i,
  /cancellation|refund/i,
  /general\s*terms/i,
  /terms\s*(&|and)\s*conditions/i,
  /recommendation|testimonial/i,
];

/**
 * Is this section house boilerplate?
 *
 * Used in two directions. house-template.ts uses it to pick what to copy off
 * the house proposal; assembleSections uses it to throw away anything the
 * model wrote on the same subjects. Both matter: the first keeps the terms and
 * the testimonials on the document, the second stops a model that ignored its
 * instructions from producing a second, invented "Service Terms" next to the
 * real one.
 *
 * Any testimonials section qualifies whatever it is titled — those are quotes
 * from real, named people and are never model output.
 */
export function isBoilerplate(section: {
  type?: unknown;
  title?: unknown;
}): boolean {
  if (String(section.type ?? "") === "testimonials") return true;
  const title = String(section.title ?? "");
  return BOILERPLATE_TITLE_PATTERNS.some((p) => p.test(title));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, max = 2000): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Headline stats sit side by side; label/value pairs stack.
 *
 * "$1,500 / Total (2 Months Upfront)" is a figure with a caption and belongs in
 * one row of wide cells — that is the band across the top of a house proposal.
 * "Plan / Discounted Basic Plan" is a spec sheet and belongs in two columns.
 *
 * Decided by the section, not by guessing from the values: only Cost and
 * Investment get the headline band. The length check is a safety valve — four
 * cells side by side stop being readable once one of them holds a date range,
 * so a long value quietly falls back to the two-column layout rather than
 * shipping a squashed table to a client.
 */
const HEADLINE_VALUE_MAX = 24;

function isHeadlineStats(
  title: string,
  stats: Array<{ label: string; value: string }>,
): boolean {
  if (!/^\s*(cost|investment|summary)/i.test(title)) return false;
  if (stats.length === 0 || stats.length > 4) return false;
  return stats.every((s) => s.value.length <= HEADLINE_VALUE_MAX);
}

/**
 * Render label/value pairs as the same CKEditor table the house proposals use,
 * so the section stays editable in the sections editor afterwards.
 */
function statsTableHtml(
  stats: Array<{ label: string; value: string }>,
  headline: boolean,
): string {
  /*
   * `figure class="table"` is CKEditor's wrapper, kept so the block stays
   * editable in the sections editor. The extra class is what the public page
   * styles against — and it has to be there, because on its own `class="table"`
   * collides with Tailwind's `.table` utility (display: table), which makes the
   * figure shrink-wrap and renders a cramped little box instead of a full-width
   * band. That is what the first version shipped.
   */
  const wrap = (kind: string, body: string) =>
    `<figure class="table ${kind}"><table><tbody>${body}</tbody></table></figure>`;

  if (headline) {
    // Values on one row, labels beneath them — a stat band, not a grid. Two
    // rows rather than <br> inside a cell so each can be styled on its own.
    const values = stats.map((s) => `<td>${escapeHtml(s.value)}</td>`).join("");
    const labels = stats.map((s) => `<td>${escapeHtml(s.label)}</td>`).join("");
    return wrap("pv-stats", `<tr>${values}</tr><tr>${labels}</tr>`);
  }

  const rows = stats
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.label)}</td><td>${escapeHtml(s.value)}</td></tr>`,
    )
    .join("");
  return wrap("pv-kv", rows);
}

/**
 * Coerce the model's sections into the editor's shape.
 *
 * The JSON Schema sent to the model is flat — one section object carrying every
 * per-type payload as a nullable field — because OpenAI's strict mode does not
 * accept a discriminated union. So the payloads that do not belong to a
 * section's `type` come back as null and are dropped here rather than being
 * stored as empty arrays the editor would render as blank rows.
 */
export function normalizeSections(raw: unknown): DraftSection[] {
  const sections: DraftSection[] = [];

  asArray(raw).forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const value = entry as Record<string, unknown>;

    const type = String(value.type ?? "richtext");
    const safeType = SECTION_TYPES.has(type) ? type : "richtext";

    /*
     * The stat and key-value blocks at the top of a house proposal are CKEditor
     * tables — `<figure class="table">` wrapping a plain `<table>`. The model is
     * asked for label/value pairs instead of that markup, because asking a model
     * for nested table HTML gets you unclosed cells about one time in ten, and a
     * broken table is visible to the client.
     */
    const stats = asArray(value.stats)
      .slice(0, 8)
      .map((stat) => {
        const s = (stat ?? {}) as Record<string, unknown>;
        return {
          label: cleanText(s.label, 200),
          value: cleanText(s.value, 200),
        };
      })
      .filter((s) => s.label || s.value);

    const title = cleanText(value.title, 200);
    const modelHtml = cleanText(value.bodyHtml, 20_000);
    const bodyHtml = stats.length
      ? `${statsTableHtml(stats, isHeadlineStats(title, stats))}${modelHtml}`
      : modelHtml;

    const section: DraftSection = {
      // The model does not get to choose keys or ordering: a duplicate key
      // makes the editor's patch-by-key update two sections at once.
      key: `${safeType}-${index}`,
      type: safeType,
      title,
      bodyHtml: sanitizeProposalHtml(bodyHtml),
      order: index,
    };

    if (safeType === "scope") {
      section.items = asArray(value.items)
        .slice(0, 8)
        .map((item) => {
          const it = (item ?? {}) as Record<string, unknown>;
          const icon = String(it.icon ?? "");
          return {
            title: cleanText(it.title, 200),
            description: cleanText(it.description, 1000),
            icon: ICON_SET.has(icon) ? icon : null,
            bullets: asArray(it.bullets)
              .slice(0, 8)
              .map((b) => cleanText(b, 300))
              .filter(Boolean),
          };
        })
        .filter((item) => item.title || item.description);
    }

    if (safeType === "timeline") {
      section.phases = asArray(value.phases)
        .slice(0, 10)
        .map((phase) => {
          const p = (phase ?? {}) as Record<string, unknown>;
          return {
            label: cleanText(p.label, 200),
            duration: cleanText(p.duration, 100),
          };
        })
        .filter((phase) => phase.label);
      // The public page renders this as the client's own editable row; it is
      // part of how the timeline section works, not an optional extra.
      section.clientField = { label: "Time taken by you", unit: "days" };
    }

    if (safeType === "pricing") {
      // Rows are rebuilt from the clamped line items by buildPricingRows.
      // Whatever the model put here is thrown away on purpose.
      section.rows = [];
      section.totalLabel = cleanText(value.totalLabel, 100) || "Total";
      section.totalAmount = "";
      section.totalType = cleanText(value.totalType, 100);
    }

    sections.push(section);
  });

  return sections;
}

/**
 * Rewrite the pricing section from the line items that will actually be stored.
 *
 * The pricing table and the line items are two renderings of one number. Left
 * to itself the model writes them separately and they disagree — and after the
 * clamp above they would disagree by construction, because only the line items
 * were rescaled. A client reading a table that says one thing and paying
 * another is the worst failure this feature has available to it.
 */
export function buildPricingRows(
  sections: DraftSection[],
  lines: DraftLineItem[],
  currency: string,
): DraftSection[] {
  const total = sumLines(lines);
  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return sections.map((section) => {
    if (section.type !== "pricing") return section;
    return {
      ...section,
      rows: lines.map((line) => ({
        item: line.description,
        type: line.quantity > 1 ? `${line.quantity} ×` : "",
        amount: fmt(lineTotal(line)),
        included: false,
      })),
      totalLabel: section.totalLabel || "Total",
      totalAmount: fmt(total),
    };
  });
}

/**
 * Build the "Pricing & Payment" section from the line items.
 *
 * The model is not asked for this section at all. It is one rendering of the
 * same number as the line items, and after the budget clamp only the line items
 * moved — so anything the model wrote would be wrong by construction. A client
 * reading a table that says one thing while being charged another is the worst
 * failure available to this feature.
 */
export function makePricingSection(
  lines: DraftLineItem[],
  currency: string,
  note: string,
): DraftSection {
  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return {
    key: "pricing",
    type: "pricing",
    title: "Pricing & Payment",
    bodyHtml: sanitizeProposalHtml(note),
    order: 0,
    rows: lines.map((line) => ({
      item: line.description,
      type: line.quantity > 1 ? `${line.quantity} ×` : "One-time",
      amount: fmt(lineTotal(line)),
      included: false,
    })),
    totalLabel: "Total Investment",
    totalAmount: fmt(sumLines(lines)),
    totalType: "One-time",
  };
}

/**
 * The order a NuraView proposal is read in, taken from the house document.
 *
 * Assigned server-side rather than trusted from the model: ordering is the one
 * thing a reader notices instantly when it is wrong, and it does not need a
 * language model to get right.
 */
const CANONICAL_ORDER = [
  "intro",
  "cost",
  "engagement",
  "pricing",
  "scope",
  "timeline",
];

/**
 * What part this section plays in the document.
 *
 * Drives both the ordering and — since these become the stored keys — which of
 * the public page's named slots the section lands in. See assembleSections.
 */
function roleOf(section: DraftSection): string {
  if (section.type === "pricing") return "pricing";
  if (section.type === "scope") return "scope";
  if (section.type === "timeline") return "timeline";
  if (section.type === "testimonials") return "testimonials";
  if (isBoilerplate(section)) return "terms";
  if (/^\s*(intro|introduction|overview)\b/i.test(section.title)) return "intro";
  return /engagement/i.test(section.title) ? "engagement" : "cost";
}

/**
 * Put the document together: what the model wrote, then the pricing table, then
 * the house boilerplate.
 *
 * Boilerplate sections are spread verbatim — same bodyHtml, same testimonials,
 * same everything — with only `key` and `order` reassigned so they slot in
 * after the bespoke ones without colliding. Nothing about them is regenerated
 * or re-sanitized: they are already-published house text, and re-running a
 * sanitizer over a real person's testimonial is a way to silently change it.
 */
export function assembleSections(
  modelSections: DraftSection[],
  lines: DraftLineItem[],
  currency: string,
  pricingNote: string,
  boilerplate: Array<Record<string, unknown>> = [],
): DraftSection[] {
  /*
   * Drop anything the model wrote on a boilerplate subject.
   *
   * The prompt tells it not to write terms or testimonials. If it does anyway
   * — and models do ignore a negative instruction now and then — the document
   * would carry an invented "Service Terms" sitting next to the real one, and
   * a client would have no way to tell which they were agreeing to.
   */
  const bespoke = modelSections.filter((s) => !isBoilerplate(s));
  if (lines.length > 0) {
    bespoke.push(makePricingSection(lines, currency, pricingNote));
  }

  bespoke.sort((a, b) => {
    const ai = CANONICAL_ORDER.indexOf(roleOf(a));
    const bi = CANONICAL_ORDER.indexOf(roleOf(b));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const merged: DraftSection[] = [
    ...bespoke,
    ...boilerplate.map((s) => ({ ...s }) as unknown as DraftSection),
  ];

  /*
   * Key by ROLE, not by type and position.
   *
   * The public page addresses two sections by name — `intro` fills the block
   * beside the "Prepared for" card, `terms` renders quietly at the end without
   * a section number:
   *
   *   const intro = allSections.find((s) => s.key === "intro" && …)
   *   const terms = allSections.find((s) => s.key === "terms")
   *
   * Keys of the form `richtext-0` matched neither. The intro slot fell back to
   * canned "Thank you for the opportunity" copy — which is what left 163px of
   * white space under it — and the terms rendered as full numbered sections,
   * the heaviness that got called a red flag on a small proposal.
   *
   * Uniqueness still matters: a duplicate key makes the editor's patch-by-key
   * edit two sections at once. So the first section to claim a role keeps the
   * bare key and any later one is suffixed, which also means the first `terms`
   * section wins the slot rather than a second silently stealing it.
   */
  const used = new Map<string, number>();
  const keyFor = (section: DraftSection) => {
    const role = roleOf(section);
    const seen = (used.get(role) ?? 0) + 1;
    used.set(role, seen);
    return seen === 1 ? role : `${role}-${seen}`;
  };

  return merged.map((section, index) => ({
    ...section,
    key: keyFor(section),
    order: index,
  }));
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export class DraftRejected extends Error {}

/**
 * Full pipeline: coerce, clamp, sanitize, cross-check.
 *
 * Throws DraftRejected when the answer is not usable as a proposal. The caller
 * turns that into a 422 and writes nothing — a proposal missing its scope or
 * pricing section is worse than no proposal, because it looks finished.
 */
export function normalizeDraft(
  raw: RawDraft,
  options: {
    band: PriceBand;
    currency: string;
    defaultExpiryDays: number;
    warnings: string[];
    /**
     * Whether the caller is going to use these parts of the answer.
     *
     * A regenerate with "keep my sections" ticked discards whatever comes
     * back, so rejecting the whole draft because those discarded sections were
     * incomplete would be a failure about nothing. Both default to true, which
     * is the create path.
     */
    requireSections?: boolean;
    requireLineItems?: boolean;
    /** House terms and testimonials, copied verbatim after the model's work. */
    boilerplateSections?: Array<Record<string, unknown>>;
  },
): NormalizedDraft {
  const {
    band,
    currency,
    defaultExpiryDays,
    warnings,
    requireSections = true,
    requireLineItems = true,
    boilerplateSections = [],
  } = options;

  const title = cleanText(raw.title, 300);
  if (!title) throw new DraftRejected("The draft came back without a title.");

  const coerced = asArray(raw.lineItems)
    .map(coerceLine)
    .filter((line): line is DraftLineItem => line !== null)
    .slice(0, MAX_LINE_ITEMS);

  if (requireLineItems && coerced.length === 0) {
    throw new DraftRejected("The draft came back with no line items.");
  }

  const lineItems = clampLineItems(coerced, band, warnings);

  const modelSections = normalizeSections(raw.sections);
  if (requireSections) {
    const kinds = new Set(modelSections.map((s) => s.type));
    // The pricing section is built server-side, so it is not checked for here.
    // Scope is: a proposal without a scope of work is not a proposal, and the
    // client scrolls back to that section more than any other.
    if (!kinds.has("scope")) {
      throw new DraftRejected(
        "The draft came back without a scope of work — nothing was saved.",
      );
    }
  }
  const sections = assembleSections(
    modelSections,
    lineItems,
    currency,
    cleanText(raw.pricingNote, 1500),
    boilerplateSections,
  );

  const depositRaw = Number(raw.depositPct);
  const depositPct = Number.isFinite(depositRaw)
    ? Math.min(100, Math.max(0, Math.round(depositRaw)))
    : DEFAULT_DEPOSIT_PCT;

  const expiryRaw = Number(raw.expiresInDays);
  const expiresInDays = Number.isFinite(expiryRaw) && expiryRaw > 0
    ? Math.min(MAX_EXPIRY_DAYS, Math.max(MIN_EXPIRY_DAYS, Math.round(expiryRaw)))
    : defaultExpiryDays;

  return {
    title,
    engagementKind: engagementKindOf(raw.engagementKind),
    projectName: cleanText(raw.projectName, 300),
    clientName: cleanText(raw.clientName, 200),
    clientCompany: cleanText(raw.clientCompany, 200),
    publicNotes: cleanText(raw.publicNotes, 4000),
    internalNotes: cleanText(raw.internalNotes, 4000),
    depositPct,
    expiresInDays,
    lineItems,
    sections,
    total: sumLines(lineItems),
    warnings,
  };
}
