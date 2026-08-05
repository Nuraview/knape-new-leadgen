/**
 * "How many emails actually went out?" — the question the dashboard could not
 * answer.
 *
 * Every send figure in this product was a seven-day roll-up or a queue depth.
 * Asked how many went out yesterday, the app had nothing to say, so the first
 * plausible small number to hand got read as the answer. It was the reply
 * scanner's `scanned` count — 19 messages it had looked at — and it led to a
 * morning spent believing the sender had collapsed when it had sent 86.
 *
 * So this panel does one job: state the real number, per day, and put every
 * neighbouring number far enough away in wording that none of them can be
 * mistaken for it. Sent means left a mailbox. Nothing else on this screen does.
 */
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgenEmails } from "@/fetchers/leadgen/emails";

function dayLabel(iso: string) {
  // Parsed as local midday, not midnight: `new Date("2026-08-04")` is UTC, and
  // west of Greenwich that renders as the 3rd.
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function Big({
  value,
  label,
  hint,
}: {
  value: number | string;
  label: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-sm font-medium">{label}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function SentVolume() {
  const stats = useQuery({
    queryKey: ["leadgen", "email-stats"],
    queryFn: () => leadgenEmails.stats(7),
    staleTime: 60_000,
  });

  if (stats.isLoading) return <Skeleton className="h-52" />;

  const daily = stats.data?.daily;
  const capacity = stats.data?.capacity;
  const headroom = stats.data?.headroom;
  const week = stats.data?.window?.sent ?? 0;
  if (!daily) return null;

  const series = daily.days;
  // One scale for both bars so the split is readable as a proportion.
  const peak = Math.max(1, ...series.map((d) => d.sent + d.followups));

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">Emails sent</h2>
        <span className="text-xs text-muted-foreground">
          first contacts, to someone never written to before
        </span>
        {/*
          The day boundary, named. Two people read this dashboard from two
          countries; without saying which clock it uses, "yesterday" was worth
          arguing about and duly was.
        */}
        <span className="ms-auto rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {daily.timezone_label || "US Eastern"}
        </span>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-4">
        {/*
          The hint used to read "288 more can go out today" straight off the
          mailbox cap, directly below a panel saying "12 ready to email now".
          Both were true of something; neither answered "how many can we send",
          and sending was paused for the hour on top. Three limits shown as one.
          The server now returns the smallest, and the sentence explaining it.
        */}
        <Big
          value={daily.today}
          label="Today so far"
          hint={
            headroom
              ? `${headroom.can_send_now} can go out right now`
              : capacity
                ? `${capacity.remaining} of today's send cap left`
                : undefined
          }
        />
        <Big value={daily.yesterday} label="Yesterday" />
        <Big value={week} label="Last 7 days" />
        {/*
          Follow-ups, counted apart from first contacts and never inside them.
          A day spent chasing is not a day spent prospecting, and rolling them
          together lets one look like the other. Kept on screen because it is
          the plainest evidence the automation is working rather than idle.
        */}
        <Big
          value={daily.followups_today}
          label="Follow-ups sent today"
          hint={`${daily.followups_total.toLocaleString()} in 14 days, automatic`}
        />
      </div>

      {/*
        Fourteen days at a glance. A single day's number means very little on
        its own — 86 is a collapse against 250 and a good day against 75 — so
        the bar it sits in is the point, not the bar itself.
      */}
      <div className="mt-5 flex h-20 items-end gap-1">
        {series.map((d) => {
          const hs = Math.round((d.sent / peak) * 100);
          const hf = Math.round((d.followups / peak) * 100);
          return (
            <div
              key={d.date}
              className="group relative flex flex-1 flex-col justify-end"
              title={`${dayLabel(d.date)}: ${d.sent} first contact${
                d.sent === 1 ? "" : "s"
              }, ${d.followups} follow-up${d.followups === 1 ? "" : "s"}${
                d.bounced ? `, ${d.bounced} bounced` : ""
              }`}
            >
              <div
                className="w-full rounded-t-sm bg-primary/25"
                style={{ height: `${hf}%` }}
              />
              <div
                className="w-full rounded-b-sm bg-primary/80 group-hover:bg-primary"
                style={{
                  height: `${Math.max(hs, d.sent > 0 ? 4 : 0)}%`,
                  minHeight: d.sent + d.followups > 0 ? 2 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{dayLabel(series[0]?.date ?? "")}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-primary/80" />
            first contact
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm bg-primary/25" />
            follow-up
          </span>
        </span>
        <span>Today</span>
      </div>

      {/*
        The one honest statement of what is possible today, and which of the
        three limits is the binding one. Colour-coded by whose problem it is:
        an empty pool is lead-finding's, a full mailbox is a setting, a closed
        window is only the clock.
      */}
      {headroom ? (
        <p
          className={`mt-4 rounded-md border p-3 text-xs ${
            headroom.limited_by === "fresh contacts"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {headroom.sentence}
        </p>
      ) : null}

      {capacity ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          Capacity{" "}
          <strong className="text-foreground tabular-nums">
            {capacity.capacity}
          </strong>{" "}
          a day across {capacity.mailboxes.length} mailbox
          {capacity.mailboxes.length === 1 ? "" : "es"} ·{" "}
          <span className="tabular-nums">{capacity.used_24h}</span> used in the
          last 24 hours.
        </p>
      ) : null}
    </section>
  );
}

export default SentVolume;
