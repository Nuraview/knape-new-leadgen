/**
 * Inboxes — the sending mailboxes, ported from the cockpit's Inboxes tab.
 *
 * Outreach rotates across several mailboxes on the sending domain rather
 * than sending everything from one, and each carries its own daily cap and
 * warm-up state. That is a deliverability mechanism, not a detail: burning one
 * address burns the domain, and the domain is Dan's.
 *
 * Caps and enable/disable are editable here because they are the levers you
 * reach for when bounce rate climbs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";

type Inbox = {
  id: number;
  email: string;
  domain?: string;
  from_name?: string;
  daily_cap?: number;
  warmup_status?: string;
  health_status?: string;
  enabled?: number | boolean;
  sent_today?: number;
};

function pill(status: string | undefined) {
  const s = (status ?? "unknown").toLowerCase();
  if (s === "ok" || s === "healthy" || s === "active")
    return "bg-emerald-500/15 text-emerald-500";
  if (s === "warming" || s === "pending") return "bg-amber-500/15 text-amber-500";
  if (s === "error" || s === "failed") return "bg-red-500/15 text-red-500";
  return "bg-muted text-muted-foreground";
}

function RouteComponent() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "inboxes"],
    queryFn: () =>
      leadgen.get<{ items?: Inbox[] } | Inbox[]>("/api/outreach/inboxes"),
    refetchInterval: 60_000,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Inbox> }) =>
      leadgen.patch(`/api/outreach/inboxes/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen", "inboxes"] }),
  });

  const rows: Inbox[] = Array.isArray(data) ? data : (data?.items ?? []);

  return (
    <Layout>
      <PageTitle title="Inboxes" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Inboxes</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length ? `${rows.length} sending mailboxes` : ""}
        </span>
      </header>

      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-500">{String(error as Error)}</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No sending mailboxes configured.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((box) => {
              const enabled = box.enabled === true || box.enabled === 1;
              return (
                <div
                  key={box.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{box.email}</div>
                      {box.from_name ? (
                        <div className="text-xs text-muted-foreground">
                          from “{box.from_name}”
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`ms-auto rounded px-1.5 py-0.5 text-xs ${pill(box.health_status)}`}
                    >
                      {box.health_status ?? "unknown"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      warm-up:{" "}
                      <span
                        className={`rounded px-1.5 py-0.5 ${pill(box.warmup_status)}`}
                      >
                        {box.warmup_status ?? "unknown"}
                      </span>
                    </span>
                    {typeof box.sent_today === "number" ? (
                      <span className="tabular-nums">
                        sent today: {box.sent_today}
                        {box.daily_cap ? ` / ${box.daily_cap}` : ""}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Daily cap</span>
                      <input
                        type="number"
                        min={0}
                        defaultValue={box.daily_cap ?? 25}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (next !== box.daily_cap)
                            update.mutate({
                              id: box.id,
                              patch: { daily_cap: next },
                            });
                        }}
                        className="h-8 w-20 rounded-md border border-border bg-background px-2 tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          update.mutate({
                            id: box.id,
                            patch: { enabled: e.target.checked ? 1 : 0 },
                          })
                        }
                      />
                      <span className="text-muted-foreground">
                        {enabled ? "Sending" : "Paused"}
                      </span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {update.error ? (
          <p className="mt-3 text-xs text-red-500">
            {String(update.error as Error)}
          </p>
        ) : null}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/inboxes")({
  component: RouteComponent,
});
