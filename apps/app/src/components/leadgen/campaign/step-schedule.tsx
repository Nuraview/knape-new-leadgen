/**
 * Step 3 — pacing, and the follow-up ladder that comes with every lead.
 *
 * The follow-up cadence is shown rather than set: it comes from the cockpit's
 * MILESTONE2_FOLLOWUP_GAP_DAYS and applies to every sequence. Showing it here
 * is the point — "does each of the 200 get follow-ups?" should be answered
 * before the run, not discovered afterwards.
 */
import { useQuery } from "@tanstack/react-query";
import { leadgen } from "@/fetchers/leadgen/client";
import type { CampaignDraft } from "./types";

type Inbox = {
  id: number;
  email: string;
  daily_cap?: number | null;
  enabled?: number | null;
  warmup_status?: string | null;
};

export function StepSchedule({
  draft,
  onChange,
}: {
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
}) {
  const inboxes = useQuery({
    queryKey: ["leadgen", "inboxes"],
    queryFn: () => leadgen.get<Inbox[] | { items: Inbox[] }>("/api/outreach/inboxes"),
    staleTime: 5 * 60_000,
  });

  const list = Array.isArray(inboxes.data)
    ? inboxes.data
    : (inboxes.data?.items ?? []);
  const enabled = list.filter((i) => i.enabled !== 0);
  const dailyTotal = enabled.reduce((n, i) => n + (i.daily_cap ?? 0), 0);

  const batches = Math.max(1, Math.ceil(draft.total / draft.batchSize));
  const spanMinutes = (batches - 1) * draft.intervalMinutes;
  const spanLabel =
    spanMinutes < 60
      ? `${spanMinutes} min`
      : `${(spanMinutes / 60).toFixed(1).replace(/\.0$/, "")} h`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">How fast, and from where?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sending in spaced batches rather than all at once is what keeps a run
          from looking like a blast to the receiving server.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Batch size
          </span>
          <input
            type="number"
            min={1}
            max={draft.total}
            value={draft.batchSize}
            onChange={(e) => onChange({ batchSize: Number(e.target.value) })}
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Minutes between batches
          </span>
          <input
            type="number"
            min={0}
            max={1440}
            value={draft.intervalMinutes}
            onChange={(e) =>
              onChange({ intervalMinutes: Number(e.target.value) })
            }
            className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums"
          />
        </label>
      </div>

      <p className="text-sm">
        <strong className="tabular-nums">{draft.total}</strong> emails in{" "}
        <strong className="tabular-nums">{batches}</strong>{" "}
        {batches === 1 ? "batch" : "batches"}, finishing about{" "}
        <strong>{spanLabel}</strong> after you press send.
      </p>

      {/* The ladder every lead gets. Not configurable here — it is the
          cockpit's own cadence, applied to every sequence. */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="text-xs font-medium">Every lead gets four emails</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {["Opener — on send", "Follow-up 1 — +3 days", "Follow-up 2 — +5 days", "Follow-up 3 — +7 days"].map(
            (label, i) => (
              <span
                key={label}
                className={`rounded px-2 py-1 ${
                  i === 0
                    ? "bg-primary/15 text-primary"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {label}
              </span>
            ),
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Follow-ups are scheduled when the opener goes out and stop
          automatically if the company replies or the address bounces.
        </p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="text-xs font-medium">
          Sending from {enabled.length}{" "}
          {enabled.length === 1 ? "mailbox" : "mailboxes"} · {dailyTotal}/day
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {list.map((i) => (
            <li key={i.id} className={i.enabled === 0 ? "line-through" : ""}>
              {i.email}
              {i.daily_cap ? ` · ${i.daily_cap}/day` : ""}
              {i.enabled === 0 ? " — disabled" : ""}
              {i.warmup_status && i.warmup_status !== "warmed"
                ? ` · ${i.warmup_status}`
                : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Mailboxes rotate automatically and each stops at its own cap. Nothing
          here is chosen per lead.
        </p>
      </div>
    </div>
  );
}

export default StepSchedule;
