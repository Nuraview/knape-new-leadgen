/**
 * What one person actually spent their time on, grouped by task.
 *
 * The Employees table answers "how many hours". VK's follow-up was the obvious
 * next question — "what about tracking the task and everything, this is just
 * simple check in checkout." This is that answer: expand a row, see the tasks.
 *
 * Fetched only when a row is expanded. The table lists everyone, and eagerly
 * loading a per-task rollup for each of them would be a query per member on
 * every page load to show something usually collapsed.
 *
 * Time with no task attached is shown explicitly rather than hidden. A day
 * that is 6 hours logged and 5 hours attributed is a real fact about the data,
 * and quietly dropping the difference would make the breakdown look complete
 * when it is not.
 */
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/fetchers/get-api-url";

type Row = {
  taskId: string | null;
  title: string | null;
  projectName: string | null;
  seconds: number;
};

function hm(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function EmployeeBreakdown({
  userId,
  secondsToday,
}: {
  userId: string;
  /** The day total from the clock, to show what is unattributed. */
  secondsToday: number;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["work-time", "breakdown", userId],
    queryFn: async (): Promise<{ items: Row[] }> => {
      const r = await fetch(
        `${getApiUrl("work-time/breakdown")}?userId=${encodeURIComponent(userId)}&days=1`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load the breakdown");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <p className="px-5 py-3 text-xs text-muted-foreground">Loading tasks…</p>
    );
  }
  if (error) {
    return (
      <p className="px-5 py-3 text-xs text-destructive">
        Could not load the breakdown.
      </p>
    );
  }

  const items = data?.items ?? [];
  const attributed = items.reduce((sum, r) => sum + r.seconds, 0);
  const unattributed = Math.max(0, secondsToday - attributed);

  if (items.length === 0 && unattributed === 0) {
    return (
      <p className="px-5 py-3 text-xs text-muted-foreground">
        Nothing logged today.
      </p>
    );
  }

  return (
    <div className="px-5 py-3">
      <ul className="space-y-1">
        {items.map((r) => (
          <li
            key={r.taskId ?? "none"}
            className="flex items-center gap-3 text-xs"
          >
            <span className="min-w-0 flex-1 truncate">
              {r.title ?? "Deleted task"}
              {r.projectName ? (
                <span className="text-muted-foreground"> · {r.projectName}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums font-medium">
              {hm(r.seconds)}
            </span>
          </li>
        ))}

        {unattributed > 0 ? (
          <li className="flex items-center gap-3 border-t border-border pt-1 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate italic">
              On the clock, no task picked
            </span>
            <span className="shrink-0 tabular-nums">{hm(unattributed)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export default EmployeeBreakdown;
