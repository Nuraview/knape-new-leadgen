/**
 * Daily Activity — the outreach scoreboard.
 *
 * Ported from apps/web/app/(routes)/activity/components/ActivityBoards.tsx.
 * The behaviour is deliberately unchanged: the calls-only performance tiers
 * (Poor / Average / Good / Great job!) with their thresholds and the "X more
 * to …" nudge, the identity colours (calls red, emails indigo, views purple),
 * the count-up animation and the sparklines. This is a scoreboard the team
 * looks at every day; changing the thresholds would change what "a good day"
 * means to them.
 *
 * Two differences from the legacy version, both forced by the stack:
 *   - SWR polling becomes TanStack Query (same 60s refresh).
 *   - There is no server-rendered first paint to seed from, so the page
 *     renders skeletons until the first response instead of showing zeros —
 *     showing 0 calls to someone who has made 20 is worse than a skeleton.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, type LucideIcon, Mail, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";

type DayStat = { date: string; calls: number; emails: number; views: number };
type MetricKey = "calls" | "emails" | "views";

/** Fixed identity colours for emails/views; calls is dynamic (see callsTier). */
const META: Record<MetricKey, { label: string; Icon: LucideIcon; hex: string }> =
  {
    calls: { label: "Calls Made", Icon: Phone, hex: "#ef4444" },
    emails: { label: "Emails Sent", Icon: Mail, hex: "#4f46e5" },
    views: { label: "Projects Viewed", Icon: Eye, hex: "#7c3aed" },
  };

const ORDER: MetricKey[] = ["calls", "emails", "views"];

type Tier = {
  label: string;
  hex: string;
  lower: number;
  next: number | null;
  nextLabel: string | null;
};

/**
 * Calls performance tiers — colour and label react to today's count, and carry
 * the next threshold so the card can show a "X more to …" nudge. Calls only:
 * emails and views have no target.
 */
function callsTier(n: number): Tier {
  if (n < 10)
    return { label: "Poor", hex: "#ef4444", lower: 0, next: 10, nextLabel: "Average" };
  if (n < 25)
    return { label: "Average", hex: "#d97706", lower: 10, next: 25, nextLabel: "Good" };
  if (n < 60)
    return { label: "Good", hex: "#2563eb", lower: 25, next: 60, nextLabel: "Great job!" };
  return { label: "Great job!", hex: "#059669", lower: 60, next: null, nextLabel: null };
}

const callsHex = (n: number) => callsTier(n).hex;

/** 0→value on mount, old→new on change. Respects reduced motion. */
function useCountUp(target: number, ms = 800) {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const start = from.current;

    if (reduce || start === target) {
      setValue(target);
      from.current = target;
      return;
    }

    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / ms);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return value;
}

/** Greeting in the viewer's own clock — deliberately not the pinned IST zone. */
function useGreeting() {
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return greeting;
}

function Sparkline({ series, hex }: { series: number[]; hex: string }) {
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden>
      {series.map((v, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length day series
          key={i}
          className="w-1.5 rounded-full"
          style={{
            height: `${Math.max(12, (v / max) * 100)}%`,
            background: i === series.length - 1 ? hex : `${hex}33`,
          }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  metricKey,
  value,
  series,
}: {
  metricKey: MetricKey;
  value: number;
  series: number[];
}) {
  const shown = useCountUp(value);
  const base = META[metricKey];
  const tier = metricKey === "calls" ? callsTier(value) : null;
  const hex = tier ? tier.hex : base.hex;
  const Icon = base.Icon;

  const progress = tier
    ? tier.next
      ? Math.min(1, (value - tier.lower) / (tier.next - tier.lower))
      : 1
    : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 transition-colors duration-500"
        style={{ background: hex }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-500"
            style={{ background: `${hex}1a`, color: hex }}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {base.label}
          </span>
        </div>
        {tier ? (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-500"
            style={{ color: hex, background: `${hex}1a` }}
          >
            {tier.label}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div
          className="text-6xl font-bold leading-none tracking-tight tabular-nums transition-colors duration-500"
          style={{ color: hex }}
          aria-label={`${base.label}: ${value} today${tier ? ` (${tier.label})` : ""}`}
        >
          {shown}
        </div>
        <Sparkline series={series} hex={hex} />
      </div>

      {tier ? (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progress * 100}%`, background: hex }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {tier.next
              ? `${tier.next - value} more to ${tier.nextLabel}`
              : "Top tier — outstanding! 🎉"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">today</p>
      )}
    </div>
  );
}

const SPAN = 5;

function RouteComponent() {
  const greeting = useGreeting();
  const { data: session } = authClient.useSession();
  const name = session?.user?.name;

  const { data, isLoading } = useQuery({
    queryKey: ["crm", "activity", "stats", SPAN],
    queryFn: async (): Promise<{ today: DayStat; days: DayStat[] }> => {
      // tz is sent for contract parity with the legacy endpoint; the server
      // pins bucketing to IST and ignores it.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(
        `${getApiUrl("activity-crm/stats")}?days=${SPAN}&tz=${encodeURIComponent(tz)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load activity");
      return response.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const today = data?.today;
  const days = data?.days ?? [];
  const chrono = [...days].reverse(); // oldest → today, for the sparklines

  const total = today ? today.calls + today.emails + today.views : 0;

  const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts) : "";

  const todayLabel = today
    ? fmtDate(today.date, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  const sub =
    total === 0
      ? "Let's get the first one on the board."
      : total < 10
        ? "Good start — keep the momentum going."
        : "Strong day. Keep pushing. 🔥";

  return (
    <Layout>
      <PageTitle title="Daily Activity" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Daily Activity</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {greeting ? `${greeting}, ` : ""}
              {name || "there"}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {todayLabel}
              {todayLabel ? " · " : ""}
              {sub}
            </p>
          </div>

          {isLoading || !today ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ORDER.map((key) => (
                <Skeleton key={key} className="h-52 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ORDER.map((key) => (
                <MetricCard
                  key={key}
                  metricKey={key}
                  value={today[key]}
                  series={chrono.map((d) => d[key])}
                />
              ))}
            </div>
          )}

          {today && days.length > 1 ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="text-sm font-medium">
                  Last {days.length} days
                </span>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {ORDER.map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background:
                            k === "calls" ? callsHex(today.calls) : META[k].hex,
                        }}
                      />
                      {META[k].label.split(" ")[0]}
                    </span>
                  ))}
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-5 py-2 text-left font-medium">Day</th>
                    <th className="px-5 py-2 text-right font-medium">Calls</th>
                    <th className="px-5 py-2 text-right font-medium">Emails</th>
                    <th className="px-5 py-2 text-right font-medium">Projects</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const isToday = d.date === today.date;
                    return (
                      <tr
                        key={d.date}
                        className={`border-t border-border ${isToday ? "bg-muted/40" : ""}`}
                      >
                        <td className="px-5 py-2.5">
                          {isToday ? (
                            <span className="font-semibold">Today</span>
                          ) : (
                            fmtDate(d.date, {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                            })
                          )}
                        </td>
                        <td
                          className="px-5 py-2.5 text-right font-semibold tabular-nums"
                          style={{ color: d.calls ? callsHex(d.calls) : undefined }}
                        >
                          {d.calls}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {d.emails}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          {d.views}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/activity")({
  component: RouteComponent,
});
