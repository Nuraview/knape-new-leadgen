/**
 * Follow-ups still to go out, grouped by the day they send.
 *
 * The data was always there — 569 pending steps across 386 sequences at the
 * time this was written — but nothing queried it, so a run with hundreds of
 * follow-ups queued behind it looked identical to a run with none. "How can we
 * check follow-ups are there for all 200?" had no answer on any screen.
 *
 * Grouped by date rather than listed flat because the useful question is "what
 * goes out tomorrow", not "what is step 2 of sequence 6,410".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  leadgenEmails,
  leadgenEmailExtras,
  type ScheduledStep,
} from "@/fetchers/leadgen/emails";
import { toast } from "@/lib/toast";

function dayKey(ts: number) {
  return new Date(ts * 1000).toDateString();
}

function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function ScheduledPane() {
  const qc = useQueryClient();

  const scheduled = useQuery({
    queryKey: ["leadgen", "scheduled"],
    queryFn: () => leadgenEmails.scheduled(30),
    refetchInterval: 60_000,
  });

  // Stopping a sequence cancels its remaining follow-ups and leaves what has
  // already been sent alone. There is no per-step cancel upstream, and pretending
  // otherwise would silently drop the wrong thing.
  const stop = useMutation({
    mutationFn: (sequenceId: number) =>
      leadgenEmailExtras.stopSequence(sequenceId),
    onSuccess: () => {
      toast.success("Remaining follow-ups cancelled for that lead.");
      qc.invalidateQueries({ queryKey: ["leadgen", "scheduled"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (scheduled.isLoading) return <Skeleton className="h-96" />;
  if (scheduled.error) {
    return (
      <p className="text-sm text-red-500">
        {(scheduled.error as Error).message}
      </p>
    );
  }

  const items = scheduled.data?.items ?? [];
  const summary = scheduled.data?.summary;

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">No follow-ups scheduled.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          They are created when a campaign sends — each lead gets three, at
          three, five and seven days.
        </p>
      </div>
    );
  }

  const groups = new Map<string, ScheduledStep[]>();
  for (const step of items) {
    const key = dayKey(step.scheduled_at);
    const list = groups.get(key);
    if (list) list.push(step);
    else groups.set(key, [step]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground tabular-nums">
          {summary?.steps ?? items.length}
        </strong>{" "}
        follow-ups queued across{" "}
        <strong className="text-foreground tabular-nums">
          {summary?.sequences ?? "—"}
        </strong>{" "}
        leads, over the next 30 days. They send automatically and stop early if
        the company replies or the address bounces.
      </p>

      {[...groups.entries()].map(([key, steps]) => (
        <section key={key}>
          <header className="sticky top-0 flex items-center gap-2 bg-background/95 py-1.5 backdrop-blur">
            <h3 className="text-sm font-semibold">
              {dayLabel(steps[0].scheduled_at)}
            </h3>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
              {steps.length}
            </span>
          </header>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {steps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  follow-up {s.step_index}
                </span>
                <span className="font-medium">{s.company || s.to_email}</span>
                <span className="text-muted-foreground">{s.to_email}</span>
                {s.subject ? (
                  <span className="hidden max-w-72 truncate text-xs text-muted-foreground md:inline">
                    {s.subject}
                  </span>
                ) : null}
                <span className="ms-auto whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(s.scheduled_at * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => stop.mutate(s.sequence_id)}
                  disabled={stop.isPending}
                  className="text-xs text-red-500 underline underline-offset-2"
                >
                  cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default ScheduledPane;
