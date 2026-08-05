/**
 * Proposal editor — create and edit, on the new stack.
 *
 * Replaces the two `<a href="crmx1/proposals/...">` links that were the last
 * thing on this screen still opening the legacy app.
 *
 * `/proposals/new` and `/proposals/:id` share this component: a new proposal is
 * just one with no id yet. Saving a new one POSTs and then swaps the URL for
 * the real id, so a refresh after the first save does not create a second
 * proposal — which is what happens when "new" and "edit" are separate screens
 * that both own a draft.
 *
 * Totals shown here are advisory. The server recomputes them on every write and
 * its answer wins; this is a preview so you can see the number move while you
 * type, not the source of truth for what gets signed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  CreditCard,
  Eye,
  Link2,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Layout from "@/components/common/layout";
import { SectionsEditor } from "@/components/proposal/sections-editor";
import type { ProposalSection } from "@/types/proposal";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getApiUrl } from "@/fetchers/get-api-url";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/proposals_/$proposalId",
)({
  /*
   * The lead card's "Start blank" carries the client's details across in the
   * query string so nobody retypes a name and an email that are already on the
   * lead. Declared here because this route reads useSearch() and every sibling
   * route validates — an unvalidated search is untyped at the call site and
   * silently `undefined` at runtime when a key is renamed on one side only.
   */
  validateSearch: (raw: Record<string, unknown>) => {
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    return {
      leadId: str(raw.leadId),
      client: str(raw.client),
      company: str(raw.company),
      email: str(raw.email),
      title: str(raw.title),
      // Still read by the prefill effect: proposals started before the AI
      // drafting landed can have links with these in them.
      budget: str(raw.budget),
      timeline: str(raw.timeline),
      notes: str(raw.notes),
    };
  },
  component: RouteComponent,
});

type LineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
};

type Proposal = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  clientName: string | null;
  clientCompany: string | null;
  clientEmail: string | null;
  projectName: string | null;
  currency: string;
  grandTotal: string;
  depositAmount: string | null;
  shareToken?: string | null;
  publicNotes: string | null;
  lineItems?: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
  }>;
};

const EMPTY_LINE: LineItem = {
  description: "",
  quantity: "1",
  unitPrice: "0",
  discountPercent: "0",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(getApiUrl(path), { credentials: "include", ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `Failed (${r.status})`);
  }
  return data as T;
}

function RouteComponent() {
  const { proposalId } = Route.useParams();
  const prefill = Route.useSearch();
  const isNew = proposalId === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [id, setId] = useState(isNew ? null : proposalId);
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [publicNotes, setPublicNotes] = useState("");
  const [depositPct, setDepositPct] = useState("0");
  const [lines, setLines] = useState<LineItem[]>([{ ...EMPTY_LINE }]);
  const [status, setStatus] = useState("DRAFT");
  /*
   * The document body — the ordered section list the public page renders and
   * the legacy sections editor produces. This editor page originally shipped
   * WITHOUT it, which meant "the proposal" a client sees could not be written
   * here at all. Same shape as types/proposal.ts, so anything saved here
   * renders identically on the legacy public page.
   */
  const [sections, setSections] = useState<ProposalSection[]>([]);

  /*
   * Apply the lead's details ONCE, and only to a new proposal — re-running it
   * would fight the user's own edits on every render, and applying it to an
   * existing proposal would silently overwrite a saved client name.
   */
  const prefilled = useRef(false);
  useEffect(() => {
    if (!isNew || prefilled.current || !prefill.leadId) return;
    prefilled.current = true;

    if (prefill.client) setClientName(prefill.client);
    if (prefill.company) setClientCompany(prefill.company);
    if (prefill.email) setClientEmail(prefill.email);
    if (prefill.title) setTitle(`Proposal for ${prefill.company || prefill.client}`);
    if (prefill.budget) {
      const amount = Number(prefill.budget.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(amount) && amount > 0) {
        setLines([
          {
            ...EMPTY_LINE,
            description: prefill.title || "Project scope",
            quantity: "1",
            unitPrice: String(amount),
          },
        ]);
      }
    }
    // Timeline and scope notes become the client-visible summary — VK dictates
    // these point by point on the call, so they land verbatim rather than being
    // reformatted into something he then has to correct.
    const notes = [
      prefill.timeline ? `Timeline: ${prefill.timeline}` : "",
      prefill.notes ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    if (notes) setPublicNotes(notes);
  }, [isNew, prefill]);
  const [videoUrl, setVideoUrl] = useState("");
  const [scheduleCallUrl, setScheduleCallUrl] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [aiKeepPricing, setAiKeepPricing] = useState(false);
  const [aiKeepSections, setAiKeepSections] = useState(false);
  /** Set while a background redraft is running; drives the poll below. */
  const [redraftJobId, setRedraftJobId] = useState<string | null>(null);
  /** Same, for drafting a brand-new proposal from a typed brief. */
  const [briefJobId, setBriefJobId] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [briefBudget, setBriefBudget] = useState("");

  const { data: existing } = useQuery({
    queryKey: ["proposal", id],
    queryFn: () => api<Proposal>(`proposal/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title ?? "");
    setClientName(existing.clientName ?? "");
    setClientCompany(existing.clientCompany ?? "");
    setClientEmail(existing.clientEmail ?? "");
    setProjectName(existing.projectName ?? "");
    setCurrency(existing.currency ?? "USD");
    setPublicNotes(existing.publicNotes ?? "");
    setStatus(existing.status ?? "DRAFT");
    setSections(
      Array.isArray((existing as { sections?: unknown }).sections)
        ? ((existing as { sections?: ProposalSection[] }).sections ?? [])
        : [],
    );
    setVideoUrl((existing as { videoUrl?: string | null }).videoUrl ?? "");
    setScheduleCallUrl(
      (existing as { scheduleCallUrl?: string | null }).scheduleCallUrl ?? "",
    );
    setClientAddress(
      (existing as { clientAddress?: string | null }).clientAddress ?? "",
    );
    setInternalNotes(
      (existing as { internalNotes?: string | null }).internalNotes ?? "",
    );
    const exp = (existing as { expiresAt?: string | null }).expiresAt;
    setExpiresAt(exp ? exp.slice(0, 10) : "");
    if (existing.lineItems?.length) {
      setLines(
        existing.lineItems.map((l) => ({
          description: l.description ?? "",
          quantity: String(l.quantity ?? "1"),
          unitPrice: String(l.unitPrice ?? "0"),
          discountPercent: String(l.discountPercent ?? "0"),
        })),
      );
    }
    // Stored as an amount; shown as a percentage because that is how the
    // client described it ("pay 50% upfront").
    if (existing.depositAmount && Number(existing.grandTotal) > 0) {
      const pct =
        (Number(existing.depositAmount) / Number(existing.grandTotal)) * 100;
      setDepositPct(String(Math.round(pct)));
    }
  }, [existing]);

  // Preview only — the server recomputes and its answer is what gets stored.
  const subtotal = lines.reduce((sum, l) => {
    const q = Number(l.quantity) || 0;
    const p = Number(l.unitPrice) || 0;
    const d = Number(l.discountPercent) || 0;
    return sum + q * p * (1 - d / 100);
  }, 0);
  const deposit = (subtotal * (Number(depositPct) || 0)) / 100;

  const locked = status === "APPROVED" || status === "PAID";

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        clientName: clientName || null,
        clientCompany: clientCompany || null,
        clientEmail: clientEmail || null,
        projectName: projectName || null,
        currency,
        publicNotes: publicNotes || null,
        sections,
        videoUrl: videoUrl || null,
        scheduleCallUrl: scheduleCallUrl || null,
        clientAddress: clientAddress || null,
        internalNotes: internalNotes || null,
        expiresAt: expiresAt || null,
        depositAmount: Number(depositPct) > 0 ? deposit.toFixed(2) : null,
        pricingMode: "LINE_ITEMS" as const,
        lineItems: lines.filter((l) => l.description.trim()),
      };
      if (id) {
        return api<{ id: string }>(`proposal/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      return api<{ id: string }>("proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      if (!id) {
        // Swap the URL for the real id so a refresh edits this proposal rather
        // than starting a second one.
        setId(res.id);
        navigate({
          to: "/proposals/$proposalId",
          params: { proposalId: res.id },
          replace: true,
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const share = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`proposal/${id}/share`, { method: "POST" }),
    onSuccess: (res) => {
      navigator.clipboard.writeText(res.url).catch(() => {});
      toast.success("Share link copied");
      queryClient.invalidateQueries({ queryKey: ["proposal", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Mint (or reuse) the share link, then open the public page — which the
      legacy app still serves, so preview is the real client view. */
  const preview = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`proposal/${id}/share`, { method: "POST" }),
    onSuccess: (res) => window.open(res.url, "_blank", "noreferrer"),
    onError: (e: Error) => toast.error(e.message),
  });

  const sendEmail = useMutation({
    mutationFn: () => api(`proposal/${id}/send`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Proposal emailed to the client");
      queryClient.invalidateQueries({ queryKey: ["proposal", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTemplate = useMutation({
    mutationFn: () =>
      api(`proposal/${id}/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: title }),
      }),
    onSuccess: () => toast.success("Saved as a template"),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api(`proposal/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Proposal deleted");
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      navigate({ to: "/proposals" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Collect payment. Opens Stripe's hosted page rather than a card form we own
   * — nothing sensitive touches our origin and the link works from an email
   * with no app session.
   *
   * Three portions because VK bills in stages: "25% upfront, obviously the
   * remaining 75%, I have to send individual Stripe link".
   */
  const collect = useMutation({
    mutationFn: (portion: "deposit" | "balance" | "full") =>
      api<{ url: string; total: number; currency: string }>(
        `proposal/${id}/checkout-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portion }),
        },
      ),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noreferrer");
      toast.success(
        `Payment page opened — ${res.currency} ${res.total.toFixed(2)} (fee included)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`proposal/${id}/duplicate`, { method: "POST" }),
    onSuccess: (res) => {
      toast.success("Duplicated");
      navigate({ to: "/proposals/$proposalId", params: { proposalId: res.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Redraft this proposal from the lead it came from.
   *
   * The two "keep" flags exist because the common case is not "do it all
   * again" — it is "the scope is right, the price is wrong" or the reverse.
   * Regenerating both would throw away whichever half was just hand-corrected,
   * which is the fastest way to make somebody stop pressing the button.
   *
   * The server reloads the lead itself; nothing about the posting is sent from
   * here. Only proposals created by "Draft with AI" carry a source lead, so
   * this 400s on a hand-made one rather than inventing a context for it.
   */
  const regenerate = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>(`proposal/${id}/ai/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: aiNotes,
          keepPricing: aiKeepPricing,
          keepSections: aiKeepSections,
        }),
      }),
    onSuccess: (res) => {
      setAiOpen(false);
      setAiNotes("");
      setRedraftJobId(res.jobId);
      toast.success("Redrafting in the background.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Same poll as the lead card: the write happens after the response. */
  const redraftJob = useQuery({
    queryKey: ["proposal-ai-job", redraftJobId],
    enabled: Boolean(redraftJobId),
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)
        ?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
    queryFn: () =>
      api<{
        status: string;
        proposalId: string | null;
        error: string | null;
        warnings: string[];
      }>(`proposal/ai/jobs/${redraftJobId}`),
  });

  useEffect(() => {
    const job = redraftJob.data;
    if (!job || !redraftJobId) return;

    if (job.status === "COMPLETED") {
      setRedraftJobId(null);
      for (const warning of job.warnings ?? []) toast.warning(warning);
      toast.success("Redrafted");
      // The hydration effect above repopulates every field from the refetch,
      // so there is nothing to copy across by hand here.
      queryClient.invalidateQueries({ queryKey: ["proposal", id] });
    } else if (job.status === "FAILED") {
      setRedraftJobId(null);
      toast.error(job.error ?? "The redraft failed.");
    }
  }, [redraftJob.data, redraftJobId, id, queryClient]);

  /*
   * Draft a brand-new proposal from a typed brief.
   *
   * The lead card path needs a lead; this one is for work that arrived by any
   * other route — a referral, an email, a call. Same server-side pipeline, so
   * the document that comes out is the house document either way.
   */
  const draftFromBrief = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>("proposal/ai/draft-from-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief,
          budget: briefBudget,
          currency,
          clientName,
          clientCompany,
          clientEmail,
        }),
      }),
    onSuccess: (res) => {
      setBriefOpen(false);
      setBriefJobId(res.jobId);
      toast.success("Drafting in the background.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const briefJob = useQuery({
    queryKey: ["proposal-ai-job", briefJobId],
    enabled: Boolean(briefJobId),
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | undefined)
        ?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
    queryFn: () =>
      api<{
        status: string;
        proposalId: string | null;
        error: string | null;
        warnings: string[];
      }>(`proposal/ai/jobs/${briefJobId}`),
  });

  useEffect(() => {
    const job = briefJob.data;
    if (!job || !briefJobId) return;

    if (job.status === "COMPLETED" && job.proposalId) {
      setBriefJobId(null);
      setBrief("");
      for (const warning of job.warnings ?? []) toast.warning(warning);
      toast.success("Draft ready — review it before sending");
      // A real id now exists, so this replaces the unsaved "new" screen rather
      // than leaving a second blank proposal behind the user.
      navigate({
        to: "/proposals/$proposalId",
        params: { proposalId: job.proposalId },
        replace: true,
      });
    } else if (job.status === "FAILED") {
      setBriefJobId(null);
      toast.error(job.error ?? "The draft failed.");
    }
  }, [briefJob.data, briefJobId, navigate]);

  const setLine = (i: number, patch: Partial<LineItem>) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <Layout>
      <PageTitle title={isNew ? "New proposal" : title || "Proposal"} />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <button
          type="button"
          onClick={() => navigate({ to: "/proposals" })}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Proposals
        </button>
        <h1 className="truncate text-xl font-semibold">
          {existing?.number ? `#${existing.number} · ` : ""}
          {title || "New proposal"}
        </h1>

        <div className="ms-auto flex items-center gap-2">
          {/* A blank proposal has nothing to share, preview or redraft — the
              one useful action here is to have it written. */}
          {!id ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setBriefOpen(true)}
              disabled={draftFromBrief.isPending || Boolean(briefJobId)}
            >
              {draftFromBrief.isPending || briefJobId ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {briefJobId ? "Drafting…" : "Draft with AI"}
            </Button>
          ) : null}
          {id ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => share.mutate()}
                disabled={share.isPending}
              >
                <Link2 className="size-3.5" />
                {existing?.shareToken ? "Copy link" : "Create link"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => preview.mutate()}
                disabled={preview.isPending}
              >
                <Eye className="size-3.5" />
                Preview
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAiOpen(true)}
                disabled={regenerate.isPending || locked}
                title={
                  locked
                    ? "A signed proposal cannot be redrafted"
                    : "Rewrite this proposal from the lead"
                }
              >
                {regenerate.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Redraft
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => sendEmail.mutate()}
                disabled={sendEmail.isPending || !clientEmail.trim()}
                title={
                  clientEmail.trim()
                    ? "Email the share link to the client"
                    : "Add a client email first"
                }
              >
                <Send className="size-3.5" />
                Send
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => duplicate.mutate()}
                disabled={duplicate.isPending}
              >
                <Copy className="size-3.5" />
                Duplicate
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={collect.isPending || isNew}
                title="Create a Stripe payment page for the deposit"
                onClick={() => collect.mutate("deposit")}
              >
                <CreditCard className="size-3.5" />
                Collect deposit
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={collect.isPending || isNew}
                title="Create a Stripe payment page for the remaining balance"
                onClick={() => collect.mutate("balance")}
              >
                Balance
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveTemplate.mutate()}
                disabled={saveTemplate.isPending}
              >
                Save as template
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  if (window.confirm("Delete this proposal? The record is kept but clients lose access."))
                    remove.mutate();
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim() || locked}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-4xl space-y-5">
          {locked ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              This proposal is <strong>{status}</strong> and can no longer be
              edited — it is a signed agreement. Duplicate it to make changes.
            </div>
          ) : null}

          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Brand & Pitch Deck Proposal"
              disabled={locked}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client name">
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                disabled={locked}
              />
            </Field>
            <Field label="Company">
              <Input
                value={clientCompany}
                onChange={(e) => setClientCompany(e.target.value)}
                disabled={locked}
              />
            </Field>
            <Field label="Client email">
              <Input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@company.com"
                disabled={locked}
              />
            </Field>
            <Field label="Project">
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={locked}
              />
            </Field>
          </div>

          <section className="rounded-xl border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Line items</h2>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={locked}
                className="rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {["USD", "EUR", "GBP", "INR", "AED"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* PERSISTENT headers. These fields had placeholders ("Qty",
                "Unit price", "%") and nothing else — and a placeholder vanishes
                the instant a value is typed, so a filled row read as three
                unlabelled numbers side by side. Headers stay put. */}
            <div className="mb-1.5 grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="col-span-6">Description</span>
              <span className="col-span-2">Qty</span>
              <span className="col-span-2">Unit price</span>
              <span className="col-span-1">Disc %</span>
              <span className="col-span-1" />
            </div>

            <div className="space-y-2">
              {lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input
                    className="col-span-6"
                    placeholder="Description"
                    aria-label={`Description for line ${i + 1}`}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                    disabled={locked}
                  />
                  <Input
                    className="col-span-2"
                    inputMode="decimal"
                    placeholder="Qty"
                    aria-label={`Quantity for line ${i + 1}`}
                    title="Quantity"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                    disabled={locked}
                  />
                  <Input
                    className="col-span-2"
                    inputMode="decimal"
                    placeholder="Unit price"
                    aria-label={`Unit price for line ${i + 1}`}
                    title="Unit price"
                    value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    disabled={locked}
                  />
                  <Input
                    className="col-span-1"
                    inputMode="decimal"
                    placeholder="%"
                    aria-label={`Discount percent for line ${i + 1}`}
                    title="Discount %"
                    value={l.discountPercent}
                    onChange={(e) =>
                      setLine(i, { discountPercent: e.target.value })
                    }
                    disabled={locked}
                  />
                  <button
                    type="button"
                    aria-label="Remove line"
                    className="col-span-1 flex items-center justify-center text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setLines((prev) => prev.filter((_, n) => n !== i))
                    }
                    disabled={locked}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
              disabled={locked}
            >
              <Plus className="size-3.5" />
              Add line
            </Button>

            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Upfront</span>
                <Input
                  className="h-8 w-16"
                  inputMode="numeric"
                  value={depositPct}
                  onChange={(e) =>
                    setDepositPct(e.target.value.replace(/\D/g, ""))
                  }
                  disabled={locked}
                />
                <span className="text-muted-foreground">%</span>
                {Number(depositPct) > 0 ? (
                  <span className="text-muted-foreground">
                    = {currency} {deposit.toFixed(2)}
                  </span>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-lg font-semibold tabular-nums">
                  {currency} {subtotal.toFixed(2)}
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client address">
              <Input
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="Street, City, Country (for formal docs)"
                disabled={locked}
              />
            </Field>
            <Field label="Expires">
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={locked}
              />
            </Field>
            {/*
              TEST MODE. A proposal marked test converts, on signing, into a
              TEST invoice — so the whole rehearsal (send, sign, pay) runs on
              Stripe's test keys with card 4242 and no money moves. Without
              this, signing even an obvious "Test" proposal produced a live
              invoice and the last step of the dry run cost real money.

              Stored as a [test] marker in internalNotes, which is staff-only —
              the client never sees it.
            */}
            <Field label="Test mode">
              <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  disabled={locked}
                  checked={internalNotes.startsWith("[test]")}
                  onChange={(e) =>
                    setInternalNotes(
                      e.target.checked
                        ? "[test] Rehearsal — pays on Stripe test keys, no real money"
                        : "",
                    )
                  }
                />
                <span className="text-muted-foreground">
                  Sign &amp; pay with test cards — nothing is charged
                </span>
              </label>
            </Field>
            <Field label="Video URL">
              <Input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="Loom / YouTube link (optional)"
                disabled={locked}
              />
            </Field>
            <Field label="Schedule-a-call URL">
              <Input
                value={scheduleCallUrl}
                onChange={(e) => setScheduleCallUrl(e.target.value)}
                placeholder="tidycal.com/… (optional)"
                disabled={locked}
              />
            </Field>
          </div>

          <section className="rounded-xl border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Document sections</h2>
            {/* The legacy sections editor, ported — richtext (CKEditor),
                feature cards, pricing table, timeline, testimonials, with
                drag-reorder and per-section banner upload. What is written
                here is what the client's public page renders. */}
            <SectionsEditor sections={sections} onChange={setSections} />
          </section>

          <Field label="Notes shown to the client">
            <textarea
              value={publicNotes}
              onChange={(e) => setPublicNotes(e.target.value)}
              rows={5}
              disabled={locked}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </div>

      {briefOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
            <h2 className="text-lg font-semibold">Draft this proposal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Describe the job the way you would to a colleague. The terms,
              testimonials and branding are attached from the house proposal —
              you only need to say what this piece of work is.
            </p>

            <div className="mt-4 space-y-3">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={8}
                autoFocus
                placeholder={
                  "Shopify store for a DTC coffee brand. They have branding already.\nNeed the storefront built, 12 products, subscriptions, and a blog.\nLaunch before the end of September. They mentioned around 3k.\nNo copywriting — they write their own."
                }
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Budget (optional)
                  </label>
                  <Input
                    value={briefBudget}
                    onChange={(e) => setBriefBudget(e.target.value)}
                    placeholder="e.g. 3000"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  >
                    {["USD", "EUR", "GBP", "INR", "AED"].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Anything already filled in above — client name, company, email —
                is carried across.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={draftFromBrief.isPending}
                onClick={() => setBriefOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="gap-1.5"
                disabled={draftFromBrief.isPending || brief.trim().length < 20}
                title={
                  brief.trim().length < 20
                    ? "Say a bit more about the job first"
                    : undefined
                }
                onClick={() => draftFromBrief.mutate()}
              >
                {draftFromBrief.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Draft with AI
              </Button>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Takes about a minute and runs in the background — this closes
              straight away and opens the proposal when it is ready.
            </p>
          </div>
        </div>
      ) : null}

      {aiOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lg">
            <h2 className="text-lg font-semibold">Redraft with AI</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rewrites this proposal from the lead it came from. Anything you
              tick below is left exactly as you have it.
            </p>

            <div className="mt-4 space-y-3">
              <textarea
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                rows={5}
                placeholder={
                  "What to change this time.\ne.g. they pushed back on price, drop the retainer line\ne.g. make the scope shorter, they only want the audit"
                }
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiKeepPricing}
                  onChange={(e) => setAiKeepPricing(e.target.checked)}
                />
                Keep my line items and prices
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={aiKeepSections}
                  onChange={(e) => setAiKeepSections(e.target.checked)}
                />
                Keep my document sections
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={regenerate.isPending}
                onClick={() => setAiOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="gap-1.5"
                disabled={
                  regenerate.isPending || (aiKeepPricing && aiKeepSections)
                }
                title={
                  aiKeepPricing && aiKeepSections
                    ? "Keeping both leaves nothing to redraft"
                    : undefined
                }
                onClick={() => regenerate.mutate()}
              >
                {regenerate.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {regenerate.isPending ? "Redrafting…" : "Redraft"}
              </Button>
            </div>

            {regenerate.isPending ? (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Around a minute. Unsaved edits on this screen will be replaced
                by the new draft.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
