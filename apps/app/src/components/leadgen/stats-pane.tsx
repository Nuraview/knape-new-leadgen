/**
 * Deliverability — what happened to what has already gone out.
 *
 * Lifted out of the Outreach page unchanged when that page became a four-stage
 * flow (Campaign, Queue, Scheduled, Sent). It is the last stage: everything
 * here is history, and nothing on it starts a send.
 *
 * Opens and clicks arrive already filtered for scanner traffic. School
 * districts run Proofpoint, Mimecast and Safe Links, all of which fetch every
 * link in every message — an unfiltered "opened" figure here would be
 * flattering and wrong, and decisions get made on it.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SentVolume } from "@/components/leadgen/sent-volume";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type EngagementKind,
  leadgenEmailExtras,
  leadgenEmails,
} from "@/fetchers/leadgen/emails";

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "bad"
      ? "text-red-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "good"
          ? "text-emerald-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function StatsPane() {
  /** Which engagement list is expanded: who opened / clicked / bounced. */
  const [drill, setDrill] = useState<EngagementKind | null>(null);

  const stats = useQuery({
    queryKey: ["leadgen", "email-stats"],
    queryFn: () => leadgenEmails.stats(7),
    staleTime: 60_000,
  });

  const engagement = useQuery({
    queryKey: ["leadgen", "engagement", drill],
    queryFn: () => leadgenEmailExtras.engagement(drill as EngagementKind),
    enabled: drill !== null,
  });

  const w = stats.data?.window;

  return (
        <section>
          {/* Per-day volume first: the rates below are meaningless until you
              know how many went out to produce them. */}
          <div className="mb-5">
            <SentVolume />
          </div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Rates over the last 7 days
          </h2>
          {stats.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : w ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Sent"
                  value={w.sent}
                  hint="7-day total — today's number is above"
                />
                <Stat
                  label="Delivered"
                  value={`${w.delivered_rate}%`}
                  hint={`${w.delivered} of ${w.sent}`}
                />
                <button
                  type="button"
                  onClick={() => setDrill(drill === "opened" ? null : "opened")}
                  className="text-left"
                >
                  <Stat
                    label="Opened"
                    value={`${w.open_rate}%`}
                    hint={`${w.opened} opens · click to see who`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDrill(drill === "bounced" ? null : "bounced")
                  }
                  className="text-left"
                >
                  <Stat
                    label="Bounced"
                    value={`${w.bounce_rate}%`}
                    hint={`${w.bounced} bounces · click to see who`}
                    tone={
                      w.bounce_rate >= 5
                        ? "bad"
                        : w.bounce_rate >= 3
                          ? "warn"
                          : "good"
                    }
                  />
                </button>
              </div>
              {w.bounce_rate >= 5 ? (
                <p className="mt-3 text-xs text-red-500">
                  Bounce rate is above 5%. Raising send volume now risks the
                  sending domain's reputation — validate and enrich first.
                </p>
              ) : null}
              {drill ? (
                <div className="mt-3 rounded-lg border border-border bg-card p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {drill}
                  </div>
                  {engagement.isLoading ? (
                    <Skeleton className="mt-2 h-24" />
                  ) : (
                    <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                      {(engagement.data?.items ?? []).map((row, i) => (
                        <li
                          key={`${String(row.to_email ?? i)}-${i}`}
                          className="flex flex-wrap gap-3"
                        >
                          <span>{String(row.to_email ?? "—")}</span>
                          {row.company ? (
                            <span className="text-muted-foreground">
                              {String(row.company)}
                            </span>
                          ) : null}
                          {row.ts ? (
                            <span className="ms-auto text-xs text-muted-foreground">
                              {new Date(
                                Number(row.ts) * 1000,
                              ).toLocaleString()}
                            </span>
                          ) : null}
                        </li>
                      ))}
                      {!engagement.data?.items?.length ? (
                        <li className="text-muted-foreground">Nobody yet.</li>
                      ) : null}
                    </ul>
                  )}
                </div>
              ) : null}

              {/*
                Per-angle A/B. pick_angle() assigns an angle deterministically
                per account, so these numbers are comparable — this is the
                table that says which of the ten messages actually works.
              */}
              {stats.data?.by_angle?.length ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        {["Angle", "Sent", "Opened", "Clicked"].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 font-medium text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...stats.data.by_angle]
                        .sort((a, b) => (b.sent ?? 0) - (a.sent ?? 0))
                        .map((a) => (
                          <tr key={a.angle} className="border-t border-border">
                            <td className="px-3 py-2">{a.angle}</td>
                            <td className="px-3 py-2 tabular-nums">{a.sent}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {a.opened ?? 0}
                              {a.open_rate != null ? ` (${a.open_rate}%)` : ""}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {a.clicked ?? 0}
                              {a.click_rate != null ? ` (${a.click_rate}%)` : ""}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {stats.data?.scanner_filtered ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {stats.data.scanner_filtered} opens/clicks excluded as
                  security-scanner traffic. Large industrial firms are heavily
                  scanned; counting those would flatter the numbers.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Stats unavailable — the lead-gen cockpit did not respond.
            </p>
          )}
        </section>
  );
}

export default StatsPane;
