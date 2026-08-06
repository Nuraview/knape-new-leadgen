/**
 * Turn pipeline events into English.
 *
 * The Leads page was showing a client his own developer log:
 *
 *   [milestone1] Finished milestone1
 *   [save] Scraped 1332 leads → Postgres (dashboard live)
 *   [score] 1332 leads qualified (ICP ≥ 5) of 1332 unique companies
 *
 * `milestone1` is the name of a CLI command. `score` and `save` are internal
 * pipeline stages. "Postgres" and "ICP" are implementation. None of it is
 * something anyone can act on, and it was the most prominent thing on the
 * busiest page in the app.
 *
 * The Python event stream keeps its real stage names — operators reading
 * journalctl need them and they are what the code emits. Only the presentation
 * changes, which is why this lives in the client and not in the cockpit.
 */

/** Internal stage → what it is actually doing. */
const STAGE_LABELS: Record<string, string> = {
  scrape: "Finding new companies",
  score: "Ranking by fit",
  filter: "Filtering out poor matches",
  save: "Saving to your lead list",
  "enrich-contacts": "Finding contact details",
  contacts: "Finding contact details",
  enrich: "Researching leads",
  research: "Researching leads",
  credit: "Vendor credits",
  // The inbox agent's own stage. Without this the bar read "inbox ·" — the
  // internal name, which is exactly what this file exists to stop.
  inbox: "Checking replies",
  learning: "Learning what works",
  send: "Sending emails",
  followups: "Sending follow-ups",
};

/**
 * Stages with no meaning outside the codebase. `milestone1` is a command name,
 * not a step — showing it explains nothing and invites the question this whole
 * file exists to stop being asked.
 */
const HIDDEN_STAGES = new Set(["milestone1", "milestone2", "main", "cli"]);

/**
 * Phrases that leak the plumbing. Ordered — longer, more specific ones first,
 * so "→ Postgres (dashboard live)" is removed before "Postgres" alone would
 * strip half of it and leave the arrow behind.
 */
const REWRITES: [RegExp, string][] = [
  [/\s*→\s*Postgres \(dashboard live\)/gi, ""],
  [/\s*\(dashboard live\)/gi, ""],
  [/\bPostgres\b/gi, "your lead list"],
  [/\bmilestone\s*1\b/gi, "finding leads"],
  [/\bmilestone\s*2\b/gi, "outreach"],
  [/\bICP\s*[≥>=]+\s*\d+(\.\d+)?/gi, "a good fit"],
  [/\bICP\b/gi, "fit"],
  [/\braw rows fetched\b/gi, "Found"],
  [/\bLinkedIn profiles:\s*0 rows/gi, "No LinkedIn results"],
  [/\bleads?\b(?=\s*→)/gi, "leads"],
  [/\benrich(ment)?\b/gi, "contact-finding"],
  [/\bsequences?\b/gi, "email"],
  [/\bdata_batch\b/gi, "run"],
  // The triage summary is written for a log line, not a status bar.
  [/Inbox:\s*0 repl\(y\/ies\), 0 out-of-office, 0 opt-out, 0 bounce\(s\)\.?/gi,
   "No new replies"],
  [/(\d+) repl\(y\/ies\)/gi, "$1 replies"],
  [/(\d+) bounce\(s\)/gi, "$1 bounces"],
];

/** How the stage should read, or null when it should not be shown at all. */
export function stageLabel(stage?: string | null): string | null {
  const key = (stage ?? "").trim().toLowerCase();
  if (!key || HIDDEN_STAGES.has(key)) return null;
  return STAGE_LABELS[key] ?? key.replace(/[-_]/g, " ");
}

/** The message, with the plumbing taken out and numbers made readable. */
export function humaniseMessage(message?: string | null): string {
  let out = (message ?? "").trim();
  if (!out) return "";
  for (const [pattern, replacement] of REWRITES) {
    out = out.replace(pattern, replacement);
  }
  // Thousands separators: "1332 leads" reads as a code dump, "1,332 leads"
  // reads as a number a person wrote.
  out = out.replace(/\b(\d{4,})\b/g, (n) => Number(n).toLocaleString());
  return out.replace(/\s{2,}/g, " ").trim();
}

/** One event, ready to render. `label` is null when the stage adds nothing. */
export function humaniseEvent(e: { stage?: string | null; message?: string | null }) {
  return { label: stageLabel(e.stage), text: humaniseMessage(e.message) };
}
