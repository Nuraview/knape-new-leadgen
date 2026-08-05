/**
 * LinkedIn post scheduler.
 *
 * Posts are written ahead of time — text plus creatives — and reviewed here
 * against a feed-accurate preview: read it, look at the creative as the feed
 * will crop it, then tick or ask for a change. Approved posts go out at their
 * scheduled time; today that means posting by hand and pasting the live link
 * back in, which is what keeps this an accurate record of what went out.
 *
 * Two views over the same month because they answer different questions. The
 * calendar shows shape — where the gaps are, what is clustered — and is where
 * posts get moved. The list shows content, for reviewing a batch in one pass.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import { AgendaList } from "@/components/linkedin/agenda-list";
import {
  monthGridRange,
  monthKey,
  monthTitle,
  shiftMonth,
} from "@/components/linkedin/dates";
import { MonthCalendar } from "@/components/linkedin/month-calendar";
import { PostComposer } from "@/components/linkedin/post-composer";
import { PostDetailDialog } from "@/components/linkedin/post-detail-dialog";
import {
  api,
  type Post,
  type SchedulerMeta,
  STATUS_RAIL,
  STATUS_SHORT,
} from "@/components/linkedin/types";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import useBrand from "@/hooks/use-brand";
import { cn } from "@/lib/cn";

const VIEW_KEY = "scheduler_view";

const FILTERS: Array<[string, string]> = [
  ["", "All"],
  ["pending_approval", "Awaiting"],
  ["approved", "Approved"],
  ["needs_changes", "Changes"],
  ["draft", "Drafts"],
  ["published", "Published"],
];

const LEGEND = [
  "draft",
  "pending_approval",
  "needs_changes",
  "approved",
  "published",
];

function RouteComponent() {
  const qc = useQueryClient();
  const brand = useBrand();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [view, setView] = useState<"calendar" | "list">(() =>
    localStorage.getItem(VIEW_KEY) === "list" ? "list" : "calendar",
  );
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const meta = useQuery({
    queryKey: ["linkedin-meta"],
    queryFn: () => api<SchedulerMeta>("linkedin/meta"),
    staleTime: 5 * 60_000,
  });

  const range = monthGridRange(month);
  const posts = useQuery({
    queryKey: ["linkedin-posts", month, status],
    queryFn: () => {
      const q = new URLSearchParams({ from: range.from, to: range.to });
      if (status) q.set("status", status);
      return api<{ items: Post[] }>(`linkedin/posts?${q}`);
    },
    staleTime: 15_000,
  });

  const reschedule = useMutation({
    mutationFn: ({ id, dayKey }: { id: string; dayKey: string }) =>
      api(`linkedin/posts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduledDate: dayKey }),
      }),
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["linkedin-posts"] });
      void qc.invalidateQueries({ queryKey: ["linkedin-review-count"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const items = posts.data?.items ?? [];
  // Whose feed the preview imitates.
  const author = brand.signature?.personName || brand.shortName;

  function switchView(next: "calendar" | "list") {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  return (
    <Layout>
      <PageTitle title="Scheduler" />
      <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="font-semibold text-xl">Scheduler</h1>
        <span className="text-muted-foreground text-sm">
          {items.length} post{items.length === 1 ? "" : "s"} in view
        </span>
        <Button className="ms-auto" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New post
        </Button>
      </header>

      <div className="flex-1 space-y-4 overflow-auto p-5">
        <p className="m-0 max-w-[80ch] text-muted-foreground text-sm">
          Write the post, attach the creative, check it against the feed, then
          send it for review. Publishing is manual for now: post approved content
          on LinkedIn yourself, then paste the link back in.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[170px] text-center font-semibold text-[17px]">
              {monthTitle(month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ms-1 h-8"
              onClick={() => setMonth(monthKey(new Date()))}
            >
              Today
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filter">
            {FILTERS.map(([value, label]) => (
              <button
                key={value || "all"}
                type="button"
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[12px] transition-colors",
                  status === value
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ms-auto inline-flex gap-0.5 rounded-md bg-muted p-0.5">
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "rounded px-3.5 py-1 text-[12px] transition-colors",
                  view === v
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => switchView(v)}
              >
                {v === "calendar" ? "Month" : "List"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground" aria-hidden="true">
          {LEGEND.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", STATUS_RAIL[s])} />
              {STATUS_SHORT[s]}
            </span>
          ))}
        </div>

        {error ? <p className="text-rose-500 text-sm">{error}</p> : null}

        {posts.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : posts.error ? (
          <p className="text-rose-500 text-sm">{String(posts.error)}</p>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-border border-dashed py-14 text-center">
            <CalendarDays className="mx-auto mb-3 size-6 text-muted-foreground" />
            <p className="mb-4 text-muted-foreground text-sm">
              {status
                ? "Nothing matches that filter."
                : `No posts in ${monthTitle(month)} yet.`}
            </p>
            {status ? (
              <Button variant="outline" onClick={() => setStatus("")}>
                Show everything
              </Button>
            ) : (
              <Button onClick={() => setCreating(true)}>
                Write the first one
              </Button>
            )}
          </div>
        ) : view === "calendar" ? (
          <MonthCalendar
            month={month}
            posts={items}
            onOpen={setOpenId}
            onReschedule={(id, dayKey) => reschedule.mutate({ id, dayKey })}
          />
        ) : (
          <AgendaList posts={items} onOpen={setOpenId} />
        )}
      </div>

      <PostComposer
        open={creating}
        onClose={() => setCreating(false)}
        author={author}
        meta={meta.data}
        onCreated={(id) => {
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ["linkedin-posts"] });
          setOpenId(id);
        }}
      />

      <PostDetailDialog
        postId={openId}
        onClose={() => setOpenId(null)}
        author={author}
        meta={meta.data}
      />
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/scheduler")({
  component: RouteComponent,
});
