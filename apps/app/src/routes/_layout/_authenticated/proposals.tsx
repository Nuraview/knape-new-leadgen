/**
 * Proposals.
 *
 * Read surface: find a proposal, see its status and money, open it, read its
 * sections, line items and activity trail.
 *
 * Editing, PDF export and the client-facing share page are NOT here — they
 * still run on the legacy app, and the page says so rather than hiding it.
 * Those three move together at cutover because the share and PayPal URLs are
 * already in clients' inboxes and can only be repointed once.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute , useNavigate } from "@tanstack/react-router";
import { Eye, FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";


type Proposal = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  clientName: string | null;
  clientCompany: string | null;
  currency: string;
  grandTotal: string;
  is_shared: boolean;
  sentAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  paidAt: string | null;
  createdAt: string;
};

type Detail = Proposal & {
  sections: unknown;
  lineItems: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  activity: Record<string, unknown>[];
  clientEmail: string | null;
  projectName: string | null;
  expiresAt: string | null;
};

function statusClass(status: string): string {
  switch (status.toUpperCase()) {
    case "APPROVED":
    case "PAID":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "REJECTED":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "SENT":
    case "VIEWED":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "EXPIRED":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function money(amount: string | null, currency: string) {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["proposal", id],
    queryFn: async (): Promise<Detail> => {
      const response = await fetch(getApiUrl(`proposal/${id}`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load this proposal");
      return response.json();
    },
  });

  return (
    <aside className="flex w-[34rem] shrink-0 flex-col border-s border-border bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 className="truncate text-sm font-semibold">
          {data?.title ?? "Proposal"}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            // Edits happen here now. This used to open the legacy app.
            onClick={() =>
              navigate({
                to: "/proposals/$proposalId",
                params: { proposalId: id },
              })
            }
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Client</div>
              <div className="mt-0.5 font-medium">
                {data.clientCompany || data.clientName || "—"}
              </div>
              {data.clientEmail ? (
                <div className="text-xs text-muted-foreground">
                  {data.clientEmail}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">
                {money(data.grandTotal, data.currency)}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-[9rem_1fr] gap-y-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-xs font-medium",
                  statusClass(data.status),
                )}
              >
                {data.status}
              </span>
            </dd>
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{when(data.sentAt)}</dd>
            <dt className="text-muted-foreground">Last viewed</dt>
            <dd>
              {when(data.lastViewedAt)}
              {data.viewCount ? ` · ${data.viewCount} views` : ""}
            </dd>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{when(data.expiresAt)}</dd>
            <dt className="text-muted-foreground">Shared link</dt>
            <dd>{data.is_shared ? "active" : "not shared"}</dd>
          </dl>

          {data.lineItems.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Line items
              </h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {data.lineItems.map((li) => (
                    <tr
                      key={String(li.id)}
                      className="border-t border-border align-top"
                    >
                      <td className="py-2 pe-2">{String(li.description ?? "")}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {String(li.quantity ?? "")} ×{" "}
                        {money(String(li.unitPrice ?? "0"), data.currency)}
                      </td>
                      <td className="py-2 ps-2 text-right font-medium tabular-nums">
                        {money(String(li.lineTotal ?? "0"), data.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {data.activity.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </h3>
              <ul className="mt-2 space-y-1.5">
                {data.activity.slice(0, 20).map((a) => (
                  <li key={String(a.id)} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {String(a.type ?? a.action ?? "event")}
                    </span>{" "}
                    · {when(String(a.createdAt ?? ""))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function RouteComponent() {
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  const [templates, setTemplates] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["proposals", templates],
    queryFn: async (): Promise<{ items: Proposal[] }> => {
      const response = await fetch(
        `${getApiUrl("proposal")}?templates=${templates ? "1" : "0"}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load proposals");
      return response.json();
    },
    // Status and the view counter move when a CLIENT opens the share link, so
    // this list goes stale on its own. Same cadence as invoices; paused by
    // TanStack while the tab is in the background.
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];

  return (
    <Layout>
      <PageTitle title="Proposals" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Proposals</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={templates ? "ghost" : "default"}
            className="h-8"
            onClick={() => setTemplates(false)}
          >
            Proposals
          </Button>
          <Button
            size="sm"
            variant={templates ? "default" : "ghost"}
            className="h-8"
            onClick={() => setTemplates(true)}
          >
            Templates
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() =>
              navigate({
                to: "/proposals/$proposalId",
                params: { proposalId: "new" },
              })
            }
          >
            <Plus className="size-3.5" />
            New
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <p className="border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
            Reading is here; editing, PDF export and client share links still
            run on the legacy app. Those move together at cutover — the share
            URLs are already in clients' inboxes.
          </p>

          {isLoading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {templates ? "No templates yet." : "No proposals yet."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-left font-medium">Title</th>
                  <th className="px-5 py-2 text-left font-medium">Client</th>
                  <th className="px-5 py-2 text-left font-medium">Status</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 text-right font-medium">Views</th>
                  <th className="px-5 py-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setOpenId(p.id)}
                    className={cn(
                      "cursor-pointer border-b border-border hover:bg-accent/40",
                      openId === p.id && "bg-accent/60",
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{p.title}</span>
                        {p.number ? (
                          <span className="text-xs text-muted-foreground">
                            #{p.number}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.clientCompany || p.clientName || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-xs font-medium",
                          statusClass(p.status),
                        )}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">
                      {money(p.grandTotal, p.currency)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {p.viewCount ? (
                        <span className="inline-flex items-center gap-1">
                          <Eye className="size-3" />
                          {p.viewCount}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground">
                      {when(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {openId ? (
          <DetailPanel id={openId} onClose={() => setOpenId(null)} />
        ) : null}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/proposals")({
  component: RouteComponent,
});
