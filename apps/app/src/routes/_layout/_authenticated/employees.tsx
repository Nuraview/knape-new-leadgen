/**
 * Employees — who is on the clock and for how long (meeting 2026-07-28).
 *
 * VK: "under Employees I can see all these members… Javed has worked 3.5 hours
 * and he's still active."
 *
 * Admin-only, enforced server-side. Hours come from the voluntary clock, so
 * this is a record of what people chose to log, not a surveillance readout —
 * worth remembering before treating a low number as a fact about someone's day.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { EmployeeBreakdown } from "@/components/employee-breakdown";
import { createFileRoute } from "@tanstack/react-router";
import { Circle, Clock, Plus } from "lucide-react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { toast } from "@/lib/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";

type Member = {
  id: string;
  name: string | null;
  email: string;
  seconds_today: number;
  seconds_week: number;
  /** Auto-paused for an unanswered prompt — NOT the same as clocked out. */
  paused: boolean;
  /** Seconds docked today by unanswered prompts. */
  penalty_today: number;
  active: boolean | null;
  last_started_at: string | null;
};

function hours(seconds: number) {
  if (!seconds) return "—";
  const h = seconds / 3600;
  return `${h.toFixed(1)}h`;
}

function RouteComponent() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["work-time", "team"],
    queryFn: async (): Promise<{ items: Member[] }> => {
      const r = await fetch(getApiUrl("work-time/team"), {
        credentials: "include",
      });
      if (r.status === 403) throw new Error("Only admins can see team hours.");
      if (!r.ok) throw new Error("Failed to load team hours");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];
  const activeNow = items.filter((m) => m.active).length;
  // Which member's task breakdown is open. One at a time — this is a glance
  // surface, not a report.
  const [openId, setOpenId] = useState<string | null>(null);
  const [slotFor, setSlotFor] = useState<{ id: string; name: string } | null>(null);

  return (
    <Layout>
      <PageTitle title="Employees" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Employees</h1>
        {items.length > 0 ? (
          <span className="ms-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {activeNow} on the clock
          </span>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {error ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {(error as Error).message}
          </p>
        ) : isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Hours come from each person's own clock — they start and stop it
              themselves. A low number can mean they forgot to start it.
            </p>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 text-left font-medium">Member</th>
                    <th className="px-5 py-2.5 text-left font-medium">Status</th>
                    <th className="px-5 py-2.5 text-right font-medium">Today</th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      This week
                    </th>
                    <th className="px-5 py-2.5 text-right font-medium">
                      Adjust
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    // Key belongs on the Fragment, not the rows inside it —
                    // a keyless fragment in a map remounts both rows on every
                    // re-render and drops the expanded state.
                    <Fragment key={m.id}>
                    <tr
                      onClick={() => setOpenId(openId === m.id ? null : m.id)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/30"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium">{m.name || m.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.email}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium",
                            m.active
                              ? "text-emerald-600 dark:text-emerald-400"
                              : m.paused
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                          )}
                        >
                          <Circle
                            className={cn(
                              "size-2",
                              m.active
                                ? "fill-emerald-500 text-emerald-500"
                                : m.paused
                                  ? "fill-amber-500 text-amber-500"
                                  : "fill-muted-foreground/40 text-muted-foreground/40",
                            )}
                          />
                          {m.active
                            ? "Active"
                            : m.paused
                              ? "Paused — no answer"
                              : "Off the clock"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {hours(m.seconds_today)}
                        {m.penalty_today ? (
                          <div
                            className="text-[10px] font-normal text-amber-600 dark:text-amber-400"
                            title="Deducted for unanswered prompts"
                          >
                            −{Math.round(m.penalty_today / 60)}m
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                        {hours(m.seconds_week)}
                      </td>
                      {/* Admin actions, visible on the row rather than behind
                          the expander. VK asked for both of these and the last
                          thing he said about a feature was "don't hide it". */}
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7"
                            title={`Add a time slot for ${m.name || m.email}`}
                            onClick={(e: React.MouseEvent) => {
                              e.stopPropagation();
                              setSlotFor({ id: m.id, name: m.name || m.email });
                            }}
                          >
                            <Plus className="size-3.5" />
                            Add time
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {openId === m.id ? (
                      <tr className="border-b border-border bg-muted/30">
                        <td colSpan={5} className="p-0">
                          <EmployeeBreakdown
                            userId={m.id}
                            secondsToday={m.seconds_today}
                          />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))}
                  {items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-5 py-10 text-center text-muted-foreground"
                      >
                        <Clock className="mx-auto mb-2 size-5 opacity-40" />
                        Nobody has clocked in yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {slotFor ? (
        <AddTimeDialog member={slotFor} onClose={() => setSlotFor(null)} />
      ) : null}

    </Layout>
  );
}

function AddTimeDialog({
  member,
  onClose,
}: {
  member: { id: string; name: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(getApiUrl("work-time/entries"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.id,
          // Local wall-clock: an admin typing "09:00" means 9am where the
          // employee is, and the browser's own offset is the closest thing to
          // that we have here.
          startedAt: new Date(`${date}T${from}`).toISOString(),
          endedAt: new Date(`${date}T${to}`).toISOString(),
          note: note.trim() || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { message?: string }).message ?? "Failed");
      return data;
    },
    onSuccess: () => {
      toast.success(`Time added for ${member.name}`);
      queryClient.invalidateQueries({ queryKey: ["work-time"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-lg font-semibold">Add time for {member.name}</h2>
        {/* Says out loud that this is a hand entry. These rows are payroll
            evidence and are flagged is_manual with the admin's id server-side;
            the person reading a timesheet later deserves to know. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Recorded as a manual entry, attributed to you.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Date
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                From
              </label>
              <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                To
              </label>
              <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Note (optional)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Forgot to clock in"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Add time
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/employees")({
  component: RouteComponent,
});
