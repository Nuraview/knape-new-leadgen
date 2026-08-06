/**
 * "Do this now" — the one panel that tells Dan what his job is today.
 *
 * Everything else on Home reports. This decides. It is computed from live data
 * rather than written, so it cannot go stale and it is as useful on day two
 * hundred as on day one — which a one-time product tour is not.
 *
 * Ordered by how warm the signal is, because that is the order a salesperson
 * should work in: someone who clicked a link beats someone who opened, which
 * beats someone who was merely sent to.
 *
 * The green line at the bottom is doing real work. Almost the whole pipeline is
 * automatic — finding schools, drafting, sending, following up — so an empty
 * task list means "running fine", not "broken". Saying that out loud is the
 * difference between a quiet dashboard and a dead one.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Mail, PhoneCall, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";

type AttentionCount = { count: number };
type Attention = {
  warm: AttentionCount & { items?: Record<string, unknown>[] };
  opened: AttentionCount;
  replies: AttentionCount;
  bounced: AttentionCount;
};

type PipelineStatus = {
  schedule?: { enabled?: boolean; last_run_at?: number | null } | null;
  yield?: { today?: number; contacts?: number } | null;
};

function ago(ts?: number | null): string {
  if (!ts) return "not yet today";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Task({
  icon,
  count,
  headline,
  action,
  to,
  search,
  tone = "warm",
}: {
  icon: React.ReactNode;
  count: number;
  headline: string;
  action: string;
  to: string;
  search?: Record<string, string>;
  tone?: "warm" | "alert";
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          tone === "alert"
            ? "bg-amber-500/15 text-amber-500"
            : "bg-emerald-500/15 text-emerald-500"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm">
          <strong className="tabular-nums">{count}</strong> {headline}
        </span>
        <span className="block text-xs text-muted-foreground">{action}</span>
      </span>
      <Link
        // biome-ignore lint/suspicious/noExplicitAny: route strings are checked at build
        to={to as any}
        search={search as never}
        className="ms-auto shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Open
      </Link>
    </li>
  );
}

export function DoThisNow() {
  const attention = useQuery({
    queryKey: ["leadgen", "attention"],
    queryFn: () => leadgen.get<Attention>("/api/emails/attention?limit=10"),
    staleTime: 60_000,
  });

  const status = useQuery({
    queryKey: ["leadgen", "pipeline-status"],
    queryFn: () => leadgen.get<PipelineStatus>("/api/pipeline/status"),
    staleTime: 60_000,
  });

  if (attention.isLoading) return <Skeleton className="h-40" />;
  if (attention.error) return null;

  const a = attention.data;
  const warm = a?.warm.count ?? 0;
  const opened = a?.opened.count ?? 0;
  const replies = a?.replies.count ?? 0;
  const bounced = a?.bounced.count ?? 0;
  const found = status.data?.yield?.today ?? 0;
  const lastRun = status.data?.schedule?.last_run_at;

  const nothingToDo = warm === 0 && replies === 0 && opened === 0;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/[0.04]">
      <header className="flex items-center gap-2 px-4 pt-3.5">
        <h2 className="text-sm font-semibold">Do this now</h2>
        <span className="text-xs text-muted-foreground">
          the rest runs on its own
        </span>
      </header>

      {nothingToDo ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Nothing needs you right now. As soon as a company opens or clicks an
          email, it will appear here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60">
          {replies > 0 ? (
            <Task
              icon={<Mail className="size-4" />}
              count={replies}
              headline={replies === 1 ? "reply is waiting" : "replies are waiting"}
              action="Someone wrote back — read it and answer"
              to="/communications"
            />
          ) : null}

          {warm > 0 ? (
            <Task
              icon={<PhoneCall className="size-4" />}
              count={warm}
              headline="companies clicked your email and haven't replied"
              action="Warmest list you have. Call them or send a personal note."
              to="/home"
              search={{ focus: "clicked" }}
            />
          ) : null}

          {opened > 0 ? (
            <Task
              icon={<Mail className="size-4" />}
              count={opened}
              headline="opened but haven't clicked yet"
              action="Interested but not moved. The follow-ups are already scheduled."
              to="/home"
              search={{ focus: "opened" }}
            />
          ) : null}

          {bounced > 0 ? (
            <Task
              icon={<TriangleAlert className="size-4" />}
              count={bounced}
              headline="addresses bounced"
              action="Already excluded from future sending. Nothing to fix by hand."
              to="/home"
              search={{ focus: "bounced" }}
              tone="alert"
            />
          ) : null}
        </ul>
      )}

      {/*
        What is automatic. Without this, a short task list reads as "the system
        did nothing today" rather than "the system handled today".
      */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        <span>
          Finding companies, writing the emails, sending and following up all run
          automatically.
        </span>
        <span className="ms-auto">
          {found > 0 ? (
            <>
              Found <strong className="text-foreground tabular-nums">{found}</strong>{" "}
              today · {ago(lastRun)}
            </>
          ) : (
            <>Last checked {ago(lastRun)}</>
          )}
        </span>
      </div>
    </section>
  );
}

export default DoThisNow;
