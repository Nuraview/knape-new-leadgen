"use client";

import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDateOnly,
  formatDateTimeShort,
  livePostedAgo,
} from "@/lib/dates/short";
import { UserSearchCombobox } from "@/components/ui/user-search-combobox";
import { resolveCountry } from "@/lib/leads/country";
import { CountryFlag } from "./CountryFlag";
import { DialerMessagesSection } from "./DialerMessagesSection";
import { InlineDialer } from "./InlineDialer";
import { GenerateEmailButton } from "@/app/(routes)/crm/leads/[leadId]/components/GenerateEmailButton";
import { ArrowUpRight, Linkedin, Search } from "lucide-react";

// The sent email body is stored as CKEditor HTML. Collapse block tags to
// newlines and strip the rest for a clean text preview.
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// "Sent email" panel shown in the drawer below the Email Generator — the
// snapshot of what actually went out to this lead (subject + To/CC always,
// full body behind a toggle). Renders nothing until an email has been sent.
function SentEmailSection({
  subject,
  body,
  to,
  cc,
}: {
  subject: string | null;
  body: string | null;
  to: string | null;
  cc: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!subject && !body && !to) return null;
  const text = body ? htmlToText(body) : "";
  return (
    <div className="border-t pt-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sent Email
      </div>
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        {subject ? (
          <div className="flex items-start gap-2 font-medium">
            <span className="shrink-0">✉</span>
            <span className="min-w-0 break-words">{subject}</span>
          </div>
        ) : null}
        {to ? (
          <div className="mt-2 break-all text-xs text-muted-foreground">
            <span className="text-foreground/70">To:</span> {to}
          </div>
        ) : null}
        {cc ? (
          <div className="break-all text-xs text-muted-foreground">
            <span className="text-foreground/70">CC:</span> {cc}
          </div>
        ) : null}
        {text ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-2 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {open ? "▾ Hide message" : "▸ Show message"}
            </button>
            {open ? (
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-emerald-500/20 pt-2 text-muted-foreground">
                {text}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

type LeadFull = {
  id: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  emailSecondary: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  linkedinUrl: string | null;
  videoLink: string | null;
  description: string | null;
  upworkJobUrl: string | null;
  extractedAt: string | null;
  postedAt: string | null;
  // Raw "posted X ago" string straight from the scrape payload — shown as-is.
  postedRaw: string | null;
  highlightedAt: string | null;
  lastContactedAt: string | null;
  reminderAt: string | null;
  reminderSentAt: string | null;
  reminderFirstSentAt: string | null;
  reminderFollowupPending: boolean;
  reminderNote: string | null;
  reminderAccount: string | null;
  leadStatusId: string | null;
  statusName: string | null;
  sourcePayload: unknown;
  irrelevantAt: string | null;
  irrelevantReason: string | null;
  clientLocation: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  assigneeWhatsApp: string | null;
  generatedEmailSubject: string | null;
  generatedEmailBody: string | null;
  sentEmailSubject: string | null;
  sentEmailBody: string | null;
  sentEmailTo: string | null;
  sentEmailCc: string | null;
};

type EnrichmentLatest = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
  mode: "auto" | "manual" | "deep" | string | null;
  error: string | null;
  costUsd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type Status = { id: string; name: string };

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

// Past-hires entry shape produced by the scraper's extract_workhistory_from_nuxt_payload.
// All fields are optional — Upwork omits some on $0 fixed-price gigs, missing
// feedback, etc. — so renderers must guard for absence.
type PastHire = {
  title?: string;
  job_url?: string;
  ciphertext?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  total_billed?: string;
  hours?: string;
  hourly_rate?: string;
  freelancer_name?: string;
  freelancer_ciphertext?: string;
  client_rating?: string; // freelancer's rating of the buyer (0-5)
  client_feedback?: string; // freelancer's words about the buyer
  freelancer_rating?: string; // buyer's rating of the freelancer
  freelancer_feedback?: string; // buyer's words about the freelancer
};

function parsePastHires(sourcePayload: unknown): PastHire[] {
  if (!sourcePayload || typeof sourcePayload !== "object") return [];
  const raw = (sourcePayload as Record<string, unknown>)
    .client_job_history_full;
  if (!raw) return [];
  // The scraper writes a JSON-stringified array; the DB roundtrips it as the
  // same string inside the jsonb payload. Be defensive in case a future
  // ingest path stops the json.dumps step and stores the array directly.
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? (parsed as PastHire[]) : [];
}

// Pull the job's budget out of the scraper payload for read-only display.
// The scraper writes three keys onto source_payload (see the Upwork scraper's
// budget-extraction block): `budget_raw` — the already-formatted human string
// it lifted straight off the posting ("$500.00", or an hourly range like
// "$30.00-$50.00") — plus numeric `budget_min` / `budget_max`. We prefer
// budget_raw because it preserves exactly what Upwork showed (fixed price OR
// hourly rate, so both engagement types render without us having to guess
// which one it is); we only synthesize a "$min – $max" string from the numeric
// pair when budget_raw is absent. Returns null when there's no usable budget
// (Upwork often omits it — those rows store "N/A") so the caller can hide the
// row entirely rather than print an empty/"N/A" line.
function parseBudget(sourcePayload: unknown): string | null {
  if (!sourcePayload || typeof sourcePayload !== "object") return null;
  const p = sourcePayload as Record<string, unknown>;

  const raw = typeof p.budget_raw === "string" ? p.budget_raw.trim() : "";
  if (raw && raw.toUpperCase() !== "N/A") return raw;

  // Fall back to the numeric pair if the raw string is missing/N/A.
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      return isFinite(n) ? n : null;
    }
    return null;
  };
  const min = num(p.budget_min);
  const max = num(p.budget_max);
  const fmt = (n: number) =>
    `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (min != null && max != null)
    return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return fmt(min);
  if (max != null) return fmt(max);
  return null;
}

// Render the buyer's past hires from sourcePayload.client_job_history_full.
// Auto-expands for ≤3 hires; collapses by default for larger lists so a
// $50K-spent client with 50 past gigs doesn't push everything else off-screen.
function PastHiresSection({
  sourcePayload,
}: {
  sourcePayload: unknown;
}) {
  const hires = parsePastHires(sourcePayload);
  if (hires.length === 0) return null;

  // Aggregate signals at the header — reviewers want at-a-glance numbers
  // without expanding 50 items.
  const total = hires.length;
  const ratedHires = hires.filter((h) => h.client_rating);
  const avg =
    ratedHires.length > 0
      ? (
          ratedHires.reduce((s, h) => s + Number(h.client_rating || 0), 0) /
          ratedHires.length
        ).toFixed(2)
      : null;
  const summary = avg ? `${total} past · avg ★ ${avg}` : `${total} past`;

  return (
    <details
      className="rounded-md border p-3"
      open={total <= 3}
    >
      <summary className="cursor-pointer select-none text-xs font-medium">
        <span className="text-muted-foreground">Past hires</span>
        <span className="ml-2">{summary}</span>
      </summary>
      <ul className="mt-3 space-y-3">
        {hires.slice(0, 25).map((h, i) => (
          <li
            key={`${h.ciphertext ?? i}`}
            className="border-l-2 border-muted pl-3"
          >
            <div className="text-sm font-medium">
              {h.job_url ? (
                <a
                  href={h.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {h.title || "(untitled)"}
                </a>
              ) : (
                h.title || "(untitled)"
              )}
            </div>
            {/* Compact metadata row — only render fields that have values
                so empty $0 fixed-price gigs don't clutter the line. */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {h.client_rating ? <span>★ {h.client_rating}</span> : null}
              {h.total_billed ? <span>{h.total_billed}</span> : null}
              {h.hourly_rate ? <span>{h.hourly_rate}</span> : null}
              {h.hours ? <span>{h.hours}h</span> : null}
              {h.freelancer_name ? (
                <span>· hired {h.freelancer_name}</span>
              ) : null}
              {h.start_date ? (
                <span>· {String(h.start_date).slice(0, 10)}</span>
              ) : null}
              {h.status ? <span>· {h.status}</span> : null}
            </div>
            {/* Freelancer's feedback ABOUT the buyer — often contains the
                buyer's first name, which is the single highest-value signal
                here for personalizing outreach. Italicized so it reads as
                a quote. */}
            {h.client_feedback ? (
              <blockquote className="mt-1 border-l-2 border-emerald-500/40 bg-emerald-500/5 pl-2 py-1 text-xs italic">
                {h.client_feedback}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ul>
      {hires.length > 25 ? (
        <div className="mt-2 text-xs text-muted-foreground">
          … {hires.length - 25} more in raw payload
        </div>
      ) : null}
    </details>
  );
}

// Tiny pill rendering the latest enrichment-run status. Color-coded so the
// state is glanceable: green = COMPLETED, amber = PENDING/RUNNING, rose =
// FAILED, slate = SKIPPED, transparent when no run has happened yet.
function EnrichmentPill({
  latest,
}: {
  latest: EnrichmentLatest | null;
}) {
  if (!latest) {
    return (
      <span className="text-xs text-muted-foreground">Never enriched</span>
    );
  }
  const cls: Record<string, string> = {
    PENDING:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
    RUNNING:
      "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 animate-pulse",
    COMPLETED:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    FAILED:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40",
    SKIPPED:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40",
  };
  const label =
    latest.status === "RUNNING" || latest.status === "PENDING"
      ? `${latest.status === "PENDING" ? "Queued" : "Running"} (${latest.mode ?? ""})`
      : `${capitalize(latest.status)} (${latest.mode ?? ""})`;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${cls[latest.status] ?? ""}`}
    >
      {label}
    </span>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

// Save-on-blur text field. Local state is uncontrolled so the user can type
// freely; we PATCH on blur only when the value changed. Empty string is sent
// as null so the DB column doesn't accumulate junk whitespace.
function EditableText({
  label,
  initial,
  onSave,
  multiline,
  rows,
  placeholder,
  type,
  labelAction,
  trailing,
}: {
  label: string;
  initial: string | null;
  onSave: (value: string | null) => Promise<void>;
  multiline?: boolean;
  // Optional control rendered to the right of the label (e.g. a search
  // shortcut for the company name).
  labelAction?: React.ReactNode;
  // Optional control rendered to the right of the INPUT BOX itself (e.g. an
  // "open this URL" shortcut). Single-line fields only.
  trailing?: React.ReactNode;
  // Override the textarea height. Default 4 — small fields like reminder
  // notes. Larger values (e.g. 10) for the description, where reviewers
  // need to read and rewrite paragraphs.
  rows?: number;
  placeholder?: string;
  type?: string;
}) {
  const [value, setValue] = useState<string>(initial ?? "");
  const lastSaved = useRef<string>(initial ?? "");

  // Reset when the parent loads a different lead.
  useEffect(() => {
    setValue(initial ?? "");
    lastSaved.current = initial ?? "";
  }, [initial]);

  async function maybeSave() {
    if (value === lastSaved.current) return;
    const next = value.trim() === "" ? null : value;
    try {
      await onSave(next);
      lastSaved.current = value;
    } catch (e) {
      // Revert on failure so the UI doesn't lie about persisted state.
      setValue(lastSaved.current);
      throw e;
    }
  }

  const sharedProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(e.target.value),
    onBlur: maybeSave,
    placeholder,
  };

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs flex items-center gap-1">
        <span>{label}</span>
        {labelAction}
      </div>
      {multiline ? (
        <Textarea
          {...sharedProps}
          rows={rows ?? 4}
          className="text-sm"
        />
      ) : trailing ? (
        <div className="flex items-center gap-2">
          <Input
            {...sharedProps}
            type={type ?? "text"}
            className="text-sm"
          />
          {trailing}
        </div>
      ) : (
        <Input
          {...sharedProps}
          type={type ?? "text"}
          className="text-sm"
        />
      )}
    </div>
  );
}

export function LeadDrawer({
  leadId,
  statuses,
  onClose,
  onChanged,
}: {
  leadId: string | null;
  statuses: Status[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lead, setLead] = useState<LeadFull | null>(null);
  const [saving, setSaving] = useState(false);
  const [reminderAt, setReminderAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderAccount, setReminderAccount] = useState("VK");
  const [recipients, setRecipients] = useState<{ name: string; phone: string }[]>([]);
  const [lastContactedAt, setLastContactedAt] = useState("");
  // Local draft for the irrelevant-reason field. Pulled from the lead on
  // load so the reviewer can edit a previously-saved reason in place.
  const [irrelevantReason, setIrrelevantReason] = useState("");
  // Enrichment state for the Enrich / Deep-enrich buttons. Polled while
  // a run is in flight so the status pill updates without a manual reload.
  const [enrichLatest, setEnrichLatest] = useState<EnrichmentLatest | null>(
    null,
  );
  const [enriching, setEnriching] = useState(false);
  // A PENDING/RUNNING enrichment is "in flight" only while it's fresh
  // (< 90 s). Stale PENDING means the event was lost (orphan from before
  // the Inngest self-host fix, or a queue/network glitch) — without this,
  // the buttons stay disabled forever and the UI traps the user.
  const enrichBlocking = (() => {
    if (!enrichLatest) return false;
    const inFlight =
      enrichLatest.status === "PENDING" || enrichLatest.status === "RUNNING";
    if (!inFlight) return false;
    const startedMs = enrichLatest.createdAt
      ? new Date(enrichLatest.createdAt).getTime()
      : 0;
    return startedMs > 0 && Date.now() - startedMs < 90_000;
  })();

  useEffect(() => {
    if (!leadId) {
      setLead(null);
      setEnrichLatest(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/leads/${leadId}`, {
        credentials: "include",
      });
      if (!res.ok || cancelled) return;
      const { lead: data } = await res.json();
      setLead(data);
      // Pre-fill empty date inputs with today/now so the reviewer can
      // hit Save in one click — selecting today's date manually every
      // time was the friction point. The "current value" line beside
      // the label still reads from `lead.reminderAt` / `lead.lastContactedAt`
      // (not these draft strings), so the UI stays honest about what's
      // actually persisted vs. drafted.
      const todayLocal = toLocalInput(new Date().toISOString());
      setReminderAt(
        data.reminderAt ? toLocalInput(data.reminderAt) : todayLocal,
      );
      setReminderNote(data.reminderNote ?? "");
      setReminderAccount(data.reminderAccount ?? "VK");
      setLastContactedAt(
        data.lastContactedAt ? toLocalInput(data.lastContactedAt) : todayLocal,
      );
      setIrrelevantReason(data.irrelevantReason ?? "");
      // Pull the latest enrichment run for this lead. Best-effort —
      // the rest of the drawer renders fine even if this 500s.
      try {
        const eres = await fetch(`/api/leads/${leadId}/enrich`, {
          credentials: "include",
        });
        if (eres.ok && !cancelled) {
          const { latest } = await eres.json();
          setEnrichLatest(latest);
        }
      } catch {
        // ignore — pill just won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Fetch the configured reminder recipients once (global, not per-lead).
  useEffect(() => {
    fetch("/api/whatsapp/recipients", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.recipients) setRecipients(d.recipients); })
      .catch(() => {});
  }, []);

  // Poll the enrichment status while a run is in flight. The Inngest
  // function is async, so the user sees PENDING → RUNNING → COMPLETED
  // without a manual refresh. We re-fetch the lead row when the status
  // settles so newly-filled email / linkedin / phone columns appear.
  useEffect(() => {
    if (!leadId) return;
    if (
      enrichLatest?.status !== "PENDING" &&
      enrichLatest?.status !== "RUNNING"
    ) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const eres = await fetch(`/api/leads/${leadId}/enrich`, {
          credentials: "include",
        });
        if (!eres.ok || cancelled) return;
        const { latest } = await eres.json();
        setEnrichLatest(latest);
        // Reload the lead row when we transition out of an in-flight
        // state — that's when the function has populated columns.
        if (
          latest &&
          latest.status !== "PENDING" &&
          latest.status !== "RUNNING"
        ) {
          const res = await fetch(`/api/leads/${leadId}`, {
            credentials: "include",
          });
          if (res.ok && !cancelled) {
            const { lead: data } = await res.json();
            setLead(data);
            onChanged();
          }
        }
      } catch {
        // ignore polling failures
      }
    };
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // We intentionally depend only on the status field — the enrichLatest
    // object identity changes on every poll and would cause an interval
    // restart loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, enrichLatest?.status]);

  async function triggerEnrich(mode: "manual" | "deep"): Promise<void> {
    if (!leadId) return;
    setEnriching(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/enrich`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const { enrichmentId } = await res.json();
      // Optimistic pill — the polling loop will replace it with real state.
      setEnrichLatest({
        id: enrichmentId,
        status: "PENDING",
        mode,
        error: null,
        costUsd: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast.success(
        mode === "deep" ? "Deep enrichment queued" : "Enrichment queued",
      );
    } catch (e) {
      toast.error(`Enrich failed: ${(e as Error).message}`);
    } finally {
      setEnriching(false);
    }
  }

  async function patch(body: object): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const { lead: updated } = await res.json();
      setLead((prev) => (prev ? { ...prev, ...updated } : prev));
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  // Save a single field with a toast confirming success/failure. Returns the
  // promise so EditableText can revert on rejection.
  async function saveField(
    key: string,
    value: string | null,
  ): Promise<void> {
    try {
      await patch({ [key]: value });
      toast.success("Saved");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
      throw e;
    }
  }

  const open = leadId !== null;
  const title =
    lead?.company ||
    [lead?.firstName, lead?.lastName].filter(Boolean).join(" ") ||
    lead?.jobTitle ||
    "Lead";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-none sm:w-[92vw] lg:w-[88vw] xl:w-[85vw] sm:max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{title}</SheetTitle>
        </SheetHeader>
        {!lead ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* --- Identification --- */}
            <div className="grid grid-cols-2 gap-3">
              <EditableText
                label="Company"
                initial={lead.company}
                onSave={(v) => saveField("company", v)}
                placeholder="Company name"
                labelAction={
                  lead.company ? (
                    <button
                      type="button"
                      title="Search this company"
                      aria-label="Search this company"
                      onClick={() =>
                        window.open(
                          `https://www.google.com/search?q=${encodeURIComponent(
                            lead.company ?? "",
                          )}`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                  ) : null
                }
              />
              <EditableText
                label="Title"
                initial={lead.jobTitle}
                onSave={(v) => saveField("jobTitle", v)}
                placeholder="Job title"
                labelAction={
                  lead.upworkJobUrl ? (
                    <button
                      type="button"
                      title="Open Upwork job in a new tab"
                      aria-label="Open Upwork job"
                      onClick={() =>
                        window.open(
                          lead.upworkJobUrl ?? "",
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  ) : null
                }
              />
              <EditableText
                label="First name"
                initial={lead.firstName}
                onSave={(v) => saveField("firstName", v)}
              />
              <EditableText
                label="Last name"
                initial={lead.lastName}
                onSave={(v) => saveField("lastName", v ?? "")}
              />
            </div>

            {/* --- Contact channels --- */}
            <div className="grid grid-cols-2 gap-3">
              <EditableText
                label="Email (primary)"
                initial={lead.email}
                onSave={(v) => saveField("email", v)}
                type="email"
                placeholder="name@company.com"
              />
              <EditableText
                label="Email (secondary)"
                initial={lead.emailSecondary}
                onSave={(v) => saveField("emailSecondary", v)}
                type="email"
              />
              <EditableText
                label="Phone (primary)"
                initial={lead.phone}
                onSave={(v) => saveField("phone", v)}
                type="tel"
                placeholder="+1 555 123 4567"
              />
              <EditableText
                label="Phone (secondary)"
                initial={lead.phoneSecondary}
                onSave={(v) => saveField("phoneSecondary", v)}
                type="tel"
              />
              {/* LinkedIn — half-width (client ask Jul 2026: the old full-row
                  field was too wide). The icon to the RIGHT OF THE INPUT BOX
                  opens the saved URL in a new tab, so the reviewer doesn't have
                  to select-copy-paste it. Icon only renders once a URL is set. */}
              <EditableText
                label="LinkedIn URL"
                initial={lead.linkedinUrl}
                onSave={(v) => saveField("linkedinUrl", v)}
                type="url"
                placeholder="https://www.linkedin.com/in/…"
                trailing={
                  lead.linkedinUrl ? (
                    <button
                      type="button"
                      title="Open LinkedIn profile in a new tab"
                      aria-label="Open LinkedIn profile"
                      onClick={() =>
                        window.open(
                          lead.linkedinUrl ?? "",
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                      className="shrink-0 text-[#0a66c2] transition-opacity hover:opacity-80"
                    >
                      <Linkedin className="h-5 w-5" />
                    </button>
                  ) : null
                }
              />
              {/* Budget — read-only, straight from the scraper payload (fixed
                  price or hourly rate, whichever the posting had). Sits right
                  below LinkedIn per client ask (Jul 2026). Hidden entirely when
                  Upwork gave us no budget so we don't show an empty line. */}
              {(() => {
                const budget = parseBudget(lead.sourcePayload);
                if (!budget) return null;
                return (
                  <div className="col-span-2 space-y-1">
                    <div className="text-muted-foreground text-xs">Budget</div>
                    <div className="text-sm font-medium">{budget}</div>
                  </div>
                );
              })()}
              {/* Inline dialer: call the lead in-context using the shared
                  global Twilio device — no separate window, no page switch. */}
              {(lead.phone || lead.phoneSecondary) && (
                <div className="col-span-2">
                  <InlineDialer
                    phones={[lead.phone, lead.phoneSecondary].filter(
                      (p): p is string => !!p,
                    )}
                    leadName={title}
                  />
                </div>
              )}
            </div>

            {/* --- Description: editable, save on blur. Sits high up because
                reviewers spend most of their time reading the job posting
                body — it's the primary signal for "is this for us". rows=10
                so a typical Upwork description renders without scrolling. */}
            <EditableText
              label="Description"
              initial={lead.description}
              onSave={(v) => saveField("description", v)}
              multiline
              rows={10}
              placeholder="Internal notes / Upwork posting body"
            />

            {/* --- Video outreach (Cap, self-hosted Loom replacement) ---
                Workflow: "Record" opens Cap in a new tab → record → copy the
                /s/<id> share link → paste here (saved on blur). When the
                outreach email is sent, the link becomes a clickable animated
                GIF thumbnail card. "Copy embed HTML" gives the same card
                markup for pasting into any external composer. */}
            <div className="border-t pt-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Video
              </div>
              <EditableText
                label="Cap video link"
                initial={lead.videoLink}
                onSave={(v) => saveField("videoLink", v)}
                type="url"
                placeholder="https://cap.nuraview.com/s/…"
                trailing={
                  lead.videoLink ? (
                    <button
                      type="button"
                      title="Watch the recorded video"
                      aria-label="Watch video"
                      onClick={() =>
                        window.open(lead.videoLink ?? "", "_blank", "noopener,noreferrer")
                      }
                      className="shrink-0 transition-opacity hover:opacity-80"
                    >
                      🎬
                    </button>
                  ) : null
                }
              />
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      process.env.NEXT_PUBLIC_CAP_URL ?? "https://cap.nuraview.com",
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  🎥 Record in Cap
                </Button>
                {lead.videoLink ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/videos/embed-html", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ url: lead.videoLink }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || "Failed");
                        await navigator.clipboard.writeText(data.html);
                        toast.success("Embed HTML copied to clipboard");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Copy failed");
                      }
                    }}
                  >
                    Copy embed HTML
                  </Button>
                ) : null}
              </div>
            </div>

            {/* --- Generate Email --- */}
            {leadId && (
              <div className="border-t pt-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Email Generator
                </div>
                <GenerateEmailButton
                  firstName={lead.firstName || ""}
                  lastName={lead.lastName || ""}
                  company={lead.company || ""}
                  jobTitle={lead.jobTitle || ""}
                  description={lead.description || ""}
                  recipientEmail={lead.email || ""}
                  secondaryEmail={lead.emailSecondary || ""}
                  leadId={leadId || ""}
                  videoLink={lead.videoLink}
                  onEmailSent={onChanged}
                  initialSubject={lead.generatedEmailSubject}
                  initialBody={lead.generatedEmailBody}
                  onSaveEmail={async ({ subject, body }) => {
                    await patch({
                      generatedEmailSubject: subject || null,
                      generatedEmailBody: body || null,
                    });
                  }}
                />
              </div>
            )}

            {/* --- Sent email snapshot: what actually went out to this lead.
                Sits right under the Email Generator so the reviewer can
                generate/send above and review the sent copy here. --- */}
            <SentEmailSection
              subject={lead.sentEmailSubject}
              body={lead.sentEmailBody}
              to={lead.sentEmailTo}
              cc={lead.sentEmailCc}
            />

            {/* --- Dialer SMS/WhatsApp history (renders only when present) --- */}
            {leadId && <DialerMessagesSection leadId={leadId} />}

            {/* --- Past hires: parsed from sourcePayload.client_job_history_full,
                which the scraper extracts from Upwork's __NUXT_DATA__ visitor
                payload (see nuraview-scraper extract_workhistory_from_nuxt_payload).
                The freelancer-feedback comments here are lead-enrichment gold —
                freelancers commonly address the buyer by first name
                ("Working with Sarah was great"), which is otherwise missing
                from the scrape since Upwork hides client names on listings.
                Collapsible by default so a 50-hire client doesn't dominate
                the drawer; expanded automatically when there's just a few. */}
            <PastHiresSection sourcePayload={lead.sourcePayload} />

            {/* --- Client location: read-only, scraped from Upwork. Sits
                between contact info and status because the client uses it
                as a "should I even pursue this?" filter (timezone / language
                fit) before checking job-status fields. Flag-first so the
                eye scans country before reading the label. */}
            {(() => {
              const c = resolveCountry(lead.clientLocation);
              // city + the buyer's local time come straight from the
              // scraped payload (scraper now captures Upwork's
              // "Evesham Township 11:44 AM" line, not just the country).
              const sp = (lead.sourcePayload ?? {}) as Record<string, unknown>;
              const city =
                typeof sp.client_city === "string" ? sp.client_city.trim() : "";
              const localTime =
                typeof sp.client_local_time === "string"
                  ? sp.client_local_time.trim()
                  : "";
              if (!c && !city && !localTime) return null;
              return (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">
                    Client location
                  </div>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    {c ? (
                      <>
                        <CountryFlag iso2={c.iso2} name={c.name} width={24} />
                        <span>{c.name}</span>
                      </>
                    ) : null}
                    {city ? (
                      <span className="font-medium">· {city}</span>
                    ) : null}
                    {localTime ? (
                      <span
                        className="text-muted-foreground"
                        title="Client's local time captured when this lead was scraped (not live)"
                      >
                        · 🕐 {localTime} their time
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })()}

            {/* --- Status + Assignee --- */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium">Status</div>
                <select
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                  value={lead.leadStatusId ?? ""}
                  onChange={(e) =>
                    saveField("leadStatusId", e.target.value || null).catch(() => {})
                  }
                  disabled={saving}
                >
                  <option value="">—</option>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs font-medium">Assigned To</div>
                <UserSearchCombobox
                  value={lead.assignedTo ?? ""}
                  onChange={(val) => {
                    patch({ assignedTo: val || null })
                      .then(() => toast.success("Assignee updated"))
                      .catch((e) => toast.error(e.message));
                  }}
                  placeholder="Select assignee..."
                  disabled={saving}
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {lead.postedRaw ? (
                <>Posted: {livePostedAgo(lead.postedRaw, lead.extractedAt)} · </>
              ) : null}
              Extracted: {lead.extractedAt ? formatDateTimeShort(lead.extractedAt) : "—"}
            </div>

            {/* --- Upwork link + highlight --- */}
            <div className="flex items-center gap-3">
              {lead.upworkJobUrl ? (
                <a
                  href={lead.upworkJobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm underline"
                >
                  Open Upwork job ↗
                </a>
              ) : null}
              <Button
                size="sm"
                variant={lead.highlightedAt ? "default" : "outline"}
                onClick={() =>
                  patch({ highlighted: !lead.highlightedAt })
                    .then(() => toast.success(
                      lead.highlightedAt ? "Highlight removed" : "Highlighted",
                    ))
                    .catch((e) => toast.error(e.message))
                }
                disabled={saving}
              >
                {lead.highlightedAt ? "★ Highlighted" : "☆ Highlight"}
              </Button>
            </div>

            {/* --- Enrich controls + status pill ---
                Two actions:
                  - "Enrich" runs the cheap waterfall (~$0.05): serper for
                    LinkedIn URL + company domain → Prospeo (fallback
                    Findymail) for email → MillionVerifier to gate
                    deliverability.
                  - "Deep enrich" adds Prospeo mobile-finder (~$0.39) and
                    is intended for hot/qualified leads only.
                The pill shows the latest run's state and surfaces any
                non-fatal errors (e.g. "verify rejected ... : invalid")
                so reviewers know why a slot stayed blank. */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Enrichment
                </div>
                <EnrichmentPill latest={enrichLatest} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triggerEnrich("manual")}
                  disabled={enriching || enrichBlocking}
                >
                  Enrich
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triggerEnrich("deep")}
                  disabled={enriching || enrichBlocking}
                  title="Adds Prospeo mobile-finder (~$0.39 per valid number)"
                >
                  Deep enrich
                </Button>
                {enrichLatest?.error ? (
                  <span className="text-xs text-rose-600 dark:text-rose-300">
                    {enrichLatest.error}
                  </span>
                ) : null}
                {enrichLatest?.costUsd &&
                Number(enrichLatest.costUsd) > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    ${Number(enrichLatest.costUsd).toFixed(3)} spent
                  </span>
                ) : null}
              </div>
            </div>

            {/* --- Last contacted: date-only display, datetime input for entry --- */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Last contacted
                {lead.lastContactedAt ? (
                  <span className="ml-2 text-foreground">
                    — {formatDateOnly(lead.lastContactedAt)}
                  </span>
                ) : null}
              </Label>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={lastContactedAt}
                  onChange={(e) => setLastContactedAt(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const iso = new Date().toISOString();
                    setLastContactedAt(toLocalInput(iso));
                    saveField("lastContactedAt", iso).catch(() => {});
                  }}
                  disabled={saving}
                >
                  Today
                </Button>
                <Button
                  onClick={() =>
                    saveField(
                      "lastContactedAt",
                      fromLocalInput(lastContactedAt),
                    ).catch(() => {})
                  }
                  disabled={saving}
                >
                  Save
                </Button>
              </div>
            </div>

            {/* --- Reminder: shows current reminder w/ time, day, month --- */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Reminder
                {lead.reminderAt ? (
                  <span className="ml-2 text-foreground">
                    — {formatDateTimeShort(lead.reminderAt)}
                  </span>
                ) : null}
              </Label>
              <Input
                type="datetime-local"
                value={reminderAt}
                onChange={(e) => setReminderAt(e.target.value)}
              />
              {/* Recipient picker — only shown when recipients are configured */}
              {recipients.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Send reminder to</div>
                  <select
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                    value={reminderAccount}
                    onChange={(e) => setReminderAccount(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">— select recipient —</option>
                    {recipients.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name} ({r.phone})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Textarea
                placeholder="Reminder note (optional)"
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    patch({
                      reminderAt: fromLocalInput(reminderAt),
                      reminderNote: reminderNote || null,
                      reminderAccount: reminderAccount || null,
                    }).then(() => toast.success("Reminder saved"))
                      .catch((e) => toast.error(e.message))
                  }
                  disabled={saving || !reminderAt}
                >
                  Save reminder
                </Button>
                {lead.reminderAt ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      patch({ reminderAt: null, reminderNote: null })
                        .then(() => {
                          setReminderAt("");
                          setReminderNote("");
                          toast.success("Reminder cleared");
                        })
                        .catch((e) => toast.error(e.message))
                    }
                    disabled={saving}
                  >
                    Cancel reminder
                  </Button>
                ) : null}
              </div>
            </div>

            {/* --- Irrelevant: archive control + reason capture for AI training ---
                When marked, the reason is the signal we'll later feed to
                Gemini so it can auto-archive future matches. Restoring
                wipes the trio so the row goes back into the active pool. */}
            <div
              className={`space-y-2 rounded-md border p-3 ${
                lead.irrelevantAt
                  ? "border-rose-500/40 bg-rose-500/5"
                  : "border-dashed"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium">
                  {lead.irrelevantAt ? (
                    <span className="text-rose-700 dark:text-rose-300">
                      Marked irrelevant
                      <span className="ml-2 text-muted-foreground font-normal">
                        {formatDateTimeShort(lead.irrelevantAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Irrelevant lead?
                    </span>
                  )}
                </div>
                {lead.irrelevantAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch({ irrelevant: false })
                        .then(() => {
                          setIrrelevantReason("");
                          toast.success("Restored as relevant");
                        })
                        .catch((e) => toast.error(e.message))
                    }
                    disabled={saving}
                  >
                    Restore
                  </Button>
                ) : null}
              </div>
              <Textarea
                placeholder="Why is this irrelevant? e.g. UGC video creator request, not graphic design"
                value={irrelevantReason}
                onChange={(e) => setIrrelevantReason(e.target.value)}
                rows={2}
                className="text-sm"
              />
              {lead.irrelevantAt ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    saveField("irrelevantReason", irrelevantReason || null)
                      .catch(() => {})
                  }
                  disabled={saving || (irrelevantReason === (lead.irrelevantReason ?? ""))}
                >
                  Update reason
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    patch({
                      irrelevant: true,
                      irrelevantReason: irrelevantReason || null,
                    })
                      .then(() => toast.success("Marked irrelevant"))
                      .catch((e) => toast.error(e.message))
                  }
                  disabled={saving}
                >
                  Mark as irrelevant
                </Button>
              )}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Raw payload
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3">
                {JSON.stringify(lead.sourcePayload, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
