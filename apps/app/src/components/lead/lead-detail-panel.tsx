/**
 * Lead detail — the full record, editable.
 *
 * Ported from the legacy drawer (apps/web/app/(routes)/leads/components/
 * LeadDrawer.tsx). The previous version of this panel in the new app showed
 * five read-only rows, which is why opening a lead here felt like a
 * regression against crmx1: the team's actual workflow is to open a lead, fill
 * in the contact details they found, drop in a Cap video link and save.
 *
 * Field order and grouping follow the legacy layout deliberately — Company /
 * Title, then names, then the two email and two phone slots, LinkedIn, budget,
 * description, video. That order is muscle memory; only the styling is new.
 *
 * Budget is READ-ONLY: it comes off the scraped Upwork posting and is not
 * something the team sets. It is shown because it is the first thing anyone
 * asks about a lead.
 *
 * Shared by the list and the kanban so a card and a row open the same thing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  FileSignature,
  Bell,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Phone,
  Search,
  Sparkles,
  Star,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/fetchers/get-api-url";
import {
  setLeadContacted,
  setLeadHighlighted,
  setLeadIrrelevant,
  setLeadReminder,
} from "@/fetchers/lead/mutate-lead";
import { GenerateEmailButton } from "@/components/lead/generate-email-button";
import { InlineDialer } from "@/components/lead/inline-dialer";
import { LeadWorkflowFields } from "@/components/lead/lead-workflow-fields";
import { PastHiresSection } from "@/components/lead/past-hires-section";
import { SentEmailSection } from "@/components/lead/sent-email-section";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import { useNavigate } from "@tanstack/react-router";
import { useDialer } from "@/components/dialer/dialer-provider";
import { cn } from "@/lib/cn";

/** Only the columns this panel reads. The endpoint returns the whole row. */
export type LeadDetail = {
  id: string;
  company: string | null;
  jobTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailSecondary: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  linkedinUrl: string | null;
  videoLink: string | null;
  description: string | null;
  /** Email Generator draft, kept on the row so a review survives a close. */
  generatedEmailSubject: string | null;
  generatedEmailBody: string | null;
  /** Snapshot of what actually went out — the "Sent Email" block reads these. */
  sentEmailSubject: string | null;
  sentEmailBody: string | null;
  sentEmailTo: string | null;
  sentEmailCc: string | null;
  /** Raw scraper payload. The posting's budget lives in here, not in a column. */
  sourcePayload: unknown;
  jobUrl: string | null;
  clientLocation: string | null;
  highlightedAt: string | null;
  lastContactedAt: string | null;
  reminderAt: string | null;
  irrelevantAt: string | null;
  /** Read by the ported workflow block (status, owner, reminder, archive). */
  leadStatusId: string | null;
  assignedTo: string | null;
  reminderNote: string | null;
  reminderAccount: string | null;
  irrelevantReason: string | null;
};

/** The editable subset — exactly what PATCH /lead/:id accepts. */
const EDITABLE_FIELDS = [
  "company",
  "jobTitle",
  "firstName",
  "lastName",
  "email",
  "emailSecondary",
  "phone",
  "phoneSecondary",
  "linkedinUrl",
  "videoLink",
  "description",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];
type FormState = Record<EditableField, string>;

const EMPTY_FORM = Object.fromEntries(
  EDITABLE_FIELDS.map((f) => [f, ""]),
) as FormState;

function toForm(lead: LeadDetail): FormState {
  return Object.fromEntries(
    EDITABLE_FIELDS.map((f) => [f, lead[f] ?? ""]),
  ) as FormState;
}

/**
 * The posting's budget, out of the scraper payload.
 *
 * Ported verbatim from the legacy drawer. `budget_raw` is preferred because
 * Upwork already formats it correctly for both fixed-price and hourly
 * postings; the numeric pair is only a fallback. Returns null when Upwork gave
 * us nothing usable (those rows literally store "N/A"), so the caller hides the
 * row instead of printing an empty line.
 */
function parseBudget(sourcePayload: unknown): string | null {
  if (!sourcePayload || typeof sourcePayload !== "object") return null;
  const p = sourcePayload as Record<string, unknown>;

  const raw = typeof p.budget_raw === "string" ? p.budget_raw.trim() : "";
  if (raw && raw.toUpperCase() !== "N/A") return raw;

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly,
  action,
  onAction,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  /** Trailing affordance — "open in Upwork", "open LinkedIn", "watch video". */
  action?: { icon: typeof ExternalLink; title: string; href: string | null };
  /** Same slot, but a click handler rather than a link — search, dial. */
  onAction?: { icon: typeof ExternalLink; title: string; run: () => void };
}) {
  const Icon = action?.icon;
  const ActionIcon = onAction?.icon;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {action?.href && Icon ? (
          <a
            href={action.href}
            target="_blank"
            rel="noreferrer"
            title={action.title}
            aria-label={action.title}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon className="size-3.5" />
          </a>
        ) : null}
        {ActionIcon ? (
          <button
            type="button"
            onClick={onAction?.run}
            title={onAction?.title}
            aria-label={onAction?.title}
            className="text-muted-foreground hover:text-foreground"
          >
            <ActionIcon className="size-3.5" />
          </button>
        ) : null}
      </span>
      <Input
        type={type}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={cn("h-9", readOnly && "bg-muted/40 text-muted-foreground")}
      />
    </label>
  );
}

type EnrichmentRun = {
  id: string;
  status: string;
  mode: string | null;
  error: string | null;
  costUsd: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Enrichment controls — "Enrich" runs the cheap waterfall, "Deep enrich" adds
 * the mobile-number step.
 *
 * Polls every 2s only while a run is in flight. A PENDING row older than 90s is
 * treated as stuck rather than in-progress: the worker may never have picked it
 * up, and leaving the buttons disabled forever would strand the lead.
 *
 * NOTE for whoever reads this expecting results: production has no enrichment
 * provider keys (SERPER / PROSPEO / FINDYMAIL / MILLIONVERIFIER), so runs
 * complete having found nothing. That is true of the legacy app too — this is a
 * faithful port, not a broken one. It starts working when the keys are set.
 */
function EnrichmentSection({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["lead", leadId, "enrich"],
    queryFn: async (): Promise<{ latest: EnrichmentRun | null }> => {
      const response = await fetch(getApiUrl(`lead/${leadId}/enrich`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load enrichment status");
      return response.json();
    },
    refetchInterval: (query) => {
      const latest = query.state.data?.latest;
      if (!latest) return false;
      if (latest.status !== "PENDING" && latest.status !== "RUNNING") return false;
      // Stop polling a run that is clearly stuck; see the 90s note above.
      const age = Date.now() - new Date(latest.updatedAt).getTime();
      return age > 90_000 ? false : 2_000;
    },
  });

  const latest = data?.latest ?? null;
  const stalled =
    latest?.status === "PENDING" &&
    Date.now() - new Date(latest.updatedAt).getTime() > 90_000;
  const inFlight =
    !stalled && (latest?.status === "PENDING" || latest?.status === "RUNNING");

  const run = useMutation({
    mutationFn: async (mode: "manual" | "deep") => {
      const response = await fetch(getApiUrl(`lead/${leadId}/enrich`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", leadId, "enrich"] });
      toast.success("Enrichment queued");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not queue enrichment"),
  });

  const tone =
    latest?.status === "COMPLETED"
      ? "text-emerald-600 dark:text-emerald-400"
      : latest?.status === "FAILED"
        ? "text-rose-600 dark:text-rose-400"
        : latest?.status === "SKIPPED"
          ? "text-muted-foreground"
          : "text-blue-600 dark:text-blue-400";

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Enrichment
        </h3>
        {latest ? (
          <span className={cn("text-xs font-medium", tone)}>
            {stalled ? "STUCK" : latest.status}
            {latest.mode ? ` · ${latest.mode}` : ""}
            {latest.costUsd && Number(latest.costUsd) > 0
              ? ` · $${Number(latest.costUsd).toFixed(4)}`
              : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={inFlight || run.isPending}
          onClick={() => run.mutate("manual")}
        >
          {inFlight || run.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Enrich
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={inFlight || run.isPending}
          onClick={() => run.mutate("deep")}
          title="Adds the mobile-number lookup"
        >
          <Sparkles className="size-3.5" />
          Deep enrich
        </Button>
      </div>

      {latest?.error ? (
        <p className="mt-2 rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {latest.error}
        </p>
      ) : null}
      {stalled ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This run has been pending for over 90s — the worker may not be
          running. Try again.
        </p>
      ) : null}
    </div>
  );
}

export function LeadDetailPanel({
  leadId,
  onClose,
  onSaved,
}: {
  leadId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: access } = useMyAccess();
  /*
   * Editing the lead's contact fields is NOT the same permission as full CRM
   * access, and gating it on canAccessCrm was wrong.
   *
   * The API opened PATCH /lead/:id to the kanban role (KANBAN_WRITE_PATHS in
   * apps/api/src/lead/index.ts) so a lead-gen employee could enter the emails
   * he finds — that IS his job. This component kept the old gate, so he saw
   * every field greyed out and no Save button, and it read as him not working.
   * Second time that has happened to the same person.
   *
   * canEditLeads is served by /me/access and mirrors the API rule, so the two
   * cannot drift apart again.
   */
  const canEdit = access?.canEditLeads === true;

  const { dial, ready } = useDialer();

  /*
   * Dial from the lead, and save the caller ID while we are here.
   *
   * VK's reasoning, and it is right: he calls hundreds of people, so when one
   * calls BACK an unsaved number shows as unknown, the prospect hears "who is
   * this?" and hangs up on what is obviously a cold call. Saving the contact as
   * "Company - Name" at dial time means the return call arrives labelled.
   *
   * Fire-and-forget: a failed contact upsert must never stop the call.
   */
  const dialLead = (number: string) => {
    const trimmed = number.trim();
    if (!trimmed) return;
    if (!ready) {
      toast.error("The dialer is still connecting — try again in a moment");
      return;
    }

    const person = [form.firstName, form.lastName].filter(Boolean).join(" ").trim();
    const label = [form.company.trim(), person].filter(Boolean).join(" - ");

    if (label) {
      void fetch(getApiUrl("dialer/contacts"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label, phone: trimmed }),
      }).catch(() => undefined);
    }

    dial(trimmed);
    toast.success(`Calling ${label || trimmed}`);
  };

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [pNotes, setPNotes] = useState("");
  const [pCurrency, setPCurrency] = useState("USD");
  /** Set while a background draft is running; drives the poll below. */
  const [draftJobId, setDraftJobId] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async (): Promise<LeadDetail> => {
      const response = await fetch(getApiUrl(`lead/${leadId}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load this lead");
      return response.json();
    },
  });

  // Reset the form whenever a different lead is opened, and when the loaded row
  // arrives. Guarded on `dirty` so a refetch cannot wipe half-typed edits.
  useEffect(() => {
    if (lead && !dirty) setForm(toForm(lead));
  }, [lead, dirty]);

  useEffect(() => {
    setDirty(false);
  }, []);

  /*
   * Auto-save, five seconds after the last keystroke.
   *
   * VK: "you are dealing with a person who doesn't know computers... let it
   * save every five seconds." Legacy did NOT have a timer — it saved on blur —
   * but the felt behaviour is the same and this covers the case blur does not:
   * typing an email and closing the laptop without tabbing out.
   *
   * The Save button stays. It is redundant on the happy path, and it is the
   * thing that still works if this effect ever stops firing.
   */
  useEffect(() => {
    if (!dirty || !canEdit) return;
    const timer = setTimeout(() => {
      if (!save.isPending) save.mutate();
    }, 5000);
    return () => clearTimeout(timer);
    // `form` is the trigger: every edit restarts the countdown, so a fast
    // typist gets one save at the end rather than one per field.
  }, [form, dirty, canEdit]);

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl(`lead/${leadId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      toast.success("Lead saved");
      onSaved?.();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  /*
   * Draft the whole proposal server-side and open the editor on the result.
   *
   * Returns an id, not a document: the editor already loads a proposal by id,
   * and handing the form a payload to hydrate would mean a minute of model
   * time could be thrown away by a refresh. The lead is read on the server —
   * the posting, the budget, the buyer's history and the past won proposals
   * never travel through the browser.
   */
  /*
   * Drafting runs on the server as a job; this only starts it.
   *
   * The write takes a minute or two, which is too long to hold a request open
   * and much too long to make somebody watch a spinner. The POST returns a job
   * id straight away, the dialog closes, and the poll below picks it up — so
   * the lead can be closed, another opened, and the proposal still arrives.
   */
  const draftWithAi = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl("proposal/ai/draft-from-lead"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, notes: pNotes, currency: pCurrency }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        alreadyRunning?: boolean;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          data.error || data.message || `Draft failed (${response.status})`,
        );
      }
      return data;
    },
    onSuccess: (data) => {
      if (!data.jobId) return;
      setDraftJobId(data.jobId);
      setProposalOpen(false);
      toast.success(
        data.alreadyRunning
          ? "Already drafting this lead — you'll be taken there when it's ready."
          : "Drafting in the background. You can keep working.",
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not draft the proposal",
      ),
  });

  /*
   * Poll the job until it settles.
   *
   * Same shape as the enrichment poll above it. Two seconds is frequent enough
   * to feel immediate on a job that takes sixty, and the query stops entirely
   * once there is no job id, so an idle lead card makes no requests.
   */
  const draftJob = useQuery({
    queryKey: ["proposal-ai-job", draftJobId],
    enabled: Boolean(draftJobId),
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)
        ?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`proposal/ai/jobs/${draftJobId}`),
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Lost track of the draft.");
      return (await response.json()) as {
        status: string;
        proposalId: string | null;
        error: string | null;
        warnings: string[];
      };
    },
  });

  useEffect(() => {
    const job = draftJob.data;
    if (!job || !draftJobId) return;

    if (job.status === "COMPLETED" && job.proposalId) {
      setDraftJobId(null);
      // Warnings are also written into the proposal's internal notes, because
      // a toast is gone by the time anybody reads the draft.
      for (const warning of job.warnings ?? []) toast.warning(warning);
      toast.success("Draft ready — review it before sending");
      navigate({
        to: "/proposals/$proposalId",
        params: { proposalId: job.proposalId },
      });
    } else if (job.status === "FAILED") {
      setDraftJobId(null);
      toast.error(job.error ?? "The draft failed.");
    }
  }, [draftJob.data, draftJobId, navigate]);

  const flags = {
    highlighted: Boolean(lead?.highlightedAt),
    contacted: Boolean(lead?.lastContactedAt),
    hasReminder: Boolean(lead?.reminderAt),
    irrelevant: Boolean(lead?.irrelevantAt),
  };

  // The four workflow actions from the legacy drawer. They live on the panel
  // rather than on the list so the kanban gets them too — a card on the board
  // now does everything a row in the list does.
  const act = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      onSaved?.();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Action failed"),
  });

  const set = (field: EditableField) => (value: string) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Escape closes, as the legacy modal did. Registered here rather than on the
  // container so it works no matter which field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heading =
    form.company?.trim() ||
    form.jobTitle?.trim() ||
    lead?.company ||
    lead?.jobTitle ||
    "Lead";

  return (
    /*
     * Full-screen overlay, not a side rail.
     *
     * VK 2026-07-28, looking at this exact panel: "this thing, it's opening up
     * partially. I need this completely open up, just like the past one." The
     * legacy lead detail covers the page — two columns of fields, the full job
     * description, the Cap video block and the email generator all readable
     * without scrolling a 34rem gutter. At w-[34rem] every one of those was
     * stacked single-file, which is what made it read as "partially open".
     *
     * Escape closes it, and the backdrop is a real button so a click outside
     * closes it too — both behaviours the legacy modal had.
     */
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <button
        type="button"
        aria-label="Close lead"
        className="absolute inset-0 -z-10 cursor-default"
        onClick={onClose}
      />
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 className="truncate text-sm font-semibold" title={heading}>
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Button
              size="sm"
              className="h-8"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 text-sm text-muted-foreground">Loading…</div>
      ) : !lead ? (
        <div className="p-5 text-sm text-muted-foreground">
          This lead could not be loaded.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          {/* Full-bleed would stretch a label across a 27" monitor; the legacy
              modal kept its fields at a readable measure and centred them. */}
          <div className="mx-auto w-full max-w-6xl">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Company"
              value={form.company}
              onChange={set("company")}
              readOnly={!canEdit}
              placeholder="Company name"
              // Ported from legacy (LeadDrawer.tsx:720-740). Googling the
              // company is the first thing done on an unfamiliar lead.
              onAction={
                form.company
                  ? {
                      icon: Search,
                      title: "Search this company",
                      run: () =>
                        window.open(
                          `https://www.google.com/search?q=${encodeURIComponent(form.company)}`,
                          "_blank",
                          "noopener,noreferrer",
                        ),
                    }
                  : undefined
              }
            />
            <Field
              label="Title"
              value={form.jobTitle}
              onChange={set("jobTitle")}
              readOnly={!canEdit}
              placeholder="Job title"
              action={{
                icon: ExternalLink,
                title: "Open the Upwork posting",
                href: lead.jobUrl,
              }}
            />
            <Field
              label="First name"
              value={form.firstName}
              onChange={set("firstName")}
              readOnly={!canEdit}
            />
            <Field
              label="Last name"
              value={form.lastName}
              onChange={set("lastName")}
              readOnly={!canEdit}
            />
            <Field
              label="Email (primary)"
              type="email"
              value={form.email}
              onChange={set("email")}
              readOnly={!canEdit}
              placeholder="name@company.com"
            />
            <Field
              label="Email (secondary)"
              type="email"
              value={form.emailSecondary}
              onChange={set("emailSecondary")}
              readOnly={!canEdit}
            />
            <Field
              label="Phone (primary)"
              value={form.phone}
              onChange={set("phone")}
              readOnly={!canEdit}
              // Legacy put an InlineDialer here; this dials through the same
              // global provider the dialer page uses, so the call survives
              // navigating away from the lead.
              onAction={
                form.phone
                  ? {
                      icon: Phone,
                      title: `Call ${form.phone}`,
                      run: () => dialLead(form.phone),
                    }
                  : undefined
              }
              placeholder="+1 555 123 4567"
            />
            <Field
              label="Phone (secondary)"
              value={form.phoneSecondary}
              onChange={set("phoneSecondary")}
              readOnly={!canEdit}
              // Legacy put an InlineDialer here; this dials through the same
              // global provider the dialer page uses, so the call survives
              // navigating away from the lead.
              onAction={
                form.phoneSecondary
                  ? {
                      icon: Phone,
                      title: `Call ${form.phoneSecondary}`,
                      run: () => dialLead(form.phoneSecondary),
                    }
                  : undefined
              }
            />
          </div>

          {/* The old CRM's inline dialer, exactly where it sat there: right
              under the phone fields. Full call-control strip — status pill,
              confirm-before-dial, mute/hold/keypad — not just a call icon. */}
          {canEdit && (form.phone || form.phoneSecondary) ? (
            <div className="mt-4">
              <InlineDialer
                phones={[form.phone, form.phoneSecondary].filter(Boolean)}
                leadName={
                  form.company ||
                  [form.firstName, form.lastName].filter(Boolean).join(" ") ||
                  undefined
                }
              />
            </div>
          ) : null}

          <div className="mt-4">
            <Field
              label="LinkedIn URL"
              value={form.linkedinUrl}
              onChange={set("linkedinUrl")}
              readOnly={!canEdit}
              placeholder="https://www.linkedin.com/in/…"
              action={{
                icon: ExternalLink,
                title: "Open the LinkedIn profile",
                href: form.linkedinUrl || null,
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Budget
              </span>
              <p className="flex h-9 items-center text-sm font-medium tabular-nums">
                {parseBudget(lead.sourcePayload) ?? "—"}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Location
              </span>
              <p className="flex h-9 items-center text-sm">
                {lead.clientLocation ?? "—"}
              </p>
            </div>
          </div>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Description
            </span>
            <textarea
              value={form.description}
              readOnly={!canEdit}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="Internal notes / Upwork posting body"
              rows={10}
              className={cn(
                "w-full resize-y rounded-md border border-border bg-transparent p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring",
                !canEdit && "bg-muted/40 text-muted-foreground",
              )}
            />
          </label>

          {/* Section order is VK's explicit spec (meeting 2026-07-30):
              Video (the Cap link the generator embeds), Email Generator,
              Create proposal, then the record (sent email, past hires,
              workflow), with Actions and Enrichment LAST — outreach first,
              bookkeeping at the bottom. */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Video
            </h3>
            <div className="mt-2.5">
              <Field
                label="Cap video link"
                value={form.videoLink}
                onChange={set("videoLink")}
                readOnly={!canEdit}
                placeholder="https://cap.nuraview.com/s/…"
                action={{
                  icon: Video,
                  title: "Watch this video",
                  href: form.videoLink || null,
                }}
              />
            </div>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2.5 h-8 gap-1.5"
                // Opens Cap to record a walkthrough for this lead. Cap is the
                // Loom replacement the team already uses; the resulting share
                // URL is pasted back into the field above.
                render={
                  <a
                    href="https://cap.nuraview.com/record"
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <Video className="size-3.5" />
                Record in Cap
              </Button>
            ) : null}
          </div>

          {/* --- Email Generator ---
              Same position as the legacy drawer: under Video, above the sent
              snapshot, so a reviewer generates and sends here and reads what
              went out directly below. */}
          {canEdit && lead ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email Generator
              </h3>
              <div className="mt-2.5">
                <GenerateEmailButton
                  firstName={form.firstName || ""}
                  lastName={form.lastName || ""}
                  company={form.company || ""}
                  jobTitle={form.jobTitle || ""}
                  description={form.description || ""}
                  recipientEmail={form.email || ""}
                  secondaryEmail={form.emailSecondary || ""}
                  leadId={leadId}
                  videoLink={form.videoLink || null}
                  onEmailSent={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["lead", leadId],
                    });
                    onSaved?.();
                  }}
                  initialSubject={lead.generatedEmailSubject}
                  initialBody={lead.generatedEmailBody}
                  onSaveEmail={async ({ subject, body }) => {
                    // Straight to the API rather than through `save`: the
                    // draft is not part of the edit form, and routing it
                    // through the form would mark the panel dirty and fight
                    // the five-second autosave.
                    const response = await fetch(getApiUrl(`lead/${leadId}`), {
                      method: "PATCH",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        generatedEmailSubject: subject || null,
                        generatedEmailBody: body || null,
                      }),
                    });
                    if (!response.ok) throw new Error(await response.text());
                    queryClient.invalidateQueries({
                      queryKey: ["lead", leadId],
                    });
                  }}
                />
              </div>
            </div>
          ) : null}

          {/* Create proposal — directly under the generator (meeting
              2026-07-30): generate the email, then, in the same breath,
              turn the lead into a proposal. */}
          {canEdit ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Proposal
              </h3>
              <div className="mt-2.5">
                {/* VK: "once I fill up everything, there should be an option
                    for me to scroll down, create a proposal."
                    The dialog no longer asks for budget, timeline and scope —
                    all three were being retyped out of the posting that is
                    already on this row. It drafts the document instead, and
                    still offers the blank editor for the jobs that need it. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setProposalOpen(true)}
                >
                  <FileSignature className="size-3.5" />
                  Create proposal
                </Button>
              </div>
            </div>
          ) : null}

          {/* --- Sent email snapshot: what actually went out to this lead. --- */}
          <SentEmailSection
            subject={lead?.sentEmailSubject ?? null}
            body={lead?.sentEmailBody ?? null}
            to={lead?.sentEmailTo ?? null}
            cc={lead?.sentEmailCc ?? null}
          />

          {/* --- The client's hiring history, straight off the Upwork scrape. --- */}
          {lead ? <PastHiresSection sourcePayload={lead.sourcePayload} /> : null}

          {/* --- Status, owner, last contacted, reminder, irrelevant. --- */}
          {canEdit && lead ? (
            <LeadWorkflowFields
              lead={{
                id: leadId,
                leadStatusId: lead.leadStatusId,
                assignedTo: lead.assignedTo,
                lastContactedAt: lead.lastContactedAt,
                reminderAt: lead.reminderAt,
                reminderNote: lead.reminderNote,
                reminderAccount: lead.reminderAccount,
                irrelevantAt: lead.irrelevantAt,
                irrelevantReason: lead.irrelevantReason,
              }}
              onSaved={onSaved}
            />
          ) : null}

          {canEdit ? (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </h3>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(() =>
                      setLeadHighlighted(leadId, !flags.highlighted),
                    )
                  }
                >
                  <Star
                    className={cn(
                      "size-3.5",
                      flags.highlighted && "fill-amber-400 text-amber-500",
                    )}
                  />
                  {flags.highlighted ? "Unstar" : "Star"}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(() =>
                      setLeadContacted(leadId, !flags.contacted),
                    )
                  }
                >
                  <CheckCircle2
                    className={cn(
                      "size-3.5",
                      flags.contacted && "text-emerald-500",
                    )}
                  />
                  {flags.contacted ? "Mark not contacted" : "Mark contacted"}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={act.isPending}
                  onClick={() => {
                    // Tomorrow 09:00 local — the legacy drawer's default, and
                    // what the team expects "remind me" to mean.
                    const when = new Date();
                    when.setDate(when.getDate() + 1);
                    when.setHours(9, 0, 0, 0);
                    act.mutate(() =>
                      setLeadReminder(
                        leadId,
                        flags.hasReminder ? null : when.toISOString(),
                      ),
                    );
                  }}
                >
                  <Bell className="size-3.5" />
                  {flags.hasReminder ? "Clear reminder" : "Remind tomorrow 9am"}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive-foreground"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(() =>
                      setLeadIrrelevant(leadId, !flags.irrelevant),
                    )
                  }
                >
                  <Ban className="size-3.5" />
                  {flags.irrelevant ? "Restore" : "Irrelevant"}
                </Button>

              </div>
            </div>
          ) : null}

          {canEdit ? <EnrichmentSection leadId={leadId} /> : null}
          {proposalOpen ? (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
                <h2 className="text-lg font-semibold">Draft the proposal</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The posting, this buyer&apos;s history and the proposals we
                  have already won are read on the server. You only need to add
                  what is not written down anywhere.
                </p>

                <div className="mt-4 space-y-3">
                  {/* Read-only: the budget is the posting's, and typing over it
                      here only produced a number that disagreed with the lead. */}
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Posted budget
                    </span>
                    <span className="text-sm">
                      {parseBudget(lead?.sourcePayload) ?? "not stated"}
                    </span>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Currency
                    </label>
                    <select
                      value={pCurrency}
                      onChange={(e) => setPCurrency(e.target.value)}
                      className="w-full rounded-md border border-border bg-background p-2 text-sm"
                    >
                      {["USD", "EUR", "GBP", "INR", "AED"].map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Anything from the call (optional)
                    </label>
                    <textarea
                      value={pNotes}
                      onChange={(e) => setPNotes(e.target.value)}
                      rows={5}
                      placeholder={
                        "They want it live before Black Friday\nBudget is soft, they mentioned 2k is fine\nNo copywriting — they have a writer"
                      }
                      className="w-full rounded-md border border-border bg-background p-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Anything here overrides what the posting says.
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-2">
                  {/* The manual path stays. If the model is down, or the job is
                      one nobody wants it guessing at, this is still the way in. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={draftWithAi.isPending}
                    onClick={() =>
                      navigate({
                        to: "/proposals/$proposalId",
                        params: { proposalId: "new" },
                        search: {
                          leadId,
                          client: [form.firstName, form.lastName]
                            .filter(Boolean)
                            .join(" ")
                            .trim(),
                          company: form.company,
                          email: form.email,
                          title: form.jobTitle,
                        },
                      })
                    }
                  >
                    Start blank
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      disabled={draftWithAi.isPending}
                      onClick={() => setProposalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="gap-1.5"
                      disabled={draftWithAi.isPending}
                      onClick={() => draftWithAi.mutate()}
                    >
                      {draftWithAi.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      {draftWithAi.isPending ? "Starting…" : "Draft with AI"}
                    </Button>
                  </div>
                </div>

                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Takes about a minute and runs in the background — this closes
                  straight away and opens the proposal when it is ready.
                </p>
              </div>
            </div>
          ) : null}

          </div>
        </div>
      )}
    </div>
  );
}

export default LeadDetailPanel;
