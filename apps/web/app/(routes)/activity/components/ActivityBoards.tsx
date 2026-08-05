"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Phone, Mail, Eye, type LucideIcon } from "lucide-react";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

type DayStat = { date: string; calls: number; emails: number; views: number };
type MetricKey = "calls" | "emails" | "views";

// Fixed identity colours for emails/views; calls is dynamic (see callsTier).
const META: Record<MetricKey, { label: string; Icon: LucideIcon; hex: string }> = {
  calls: { label: "Calls Made", Icon: Phone, hex: "#ef4444" },
  emails: { label: "Emails Sent", Icon: Mail, hex: "#4f46e5" },
  views: { label: "Projects Viewed", Icon: Eye, hex: "#7c3aed" },
};
const ORDER: MetricKey[] = ["calls", "emails", "views"];

// Calls performance tiers — colour + label react to today's count, with the
// next threshold so we can show a "X more to …" nudge. Calls only.
type Tier = { label: string; hex: string; lower: number; next: number | null; nextLabel: string | null };
function callsTier(n: number): Tier {
  if (n < 10) return { label: "Poor", hex: "#ef4444", lower: 0, next: 10, nextLabel: "Average" };       // red
  if (n < 25) return { label: "Average", hex: "#d97706", lower: 10, next: 25, nextLabel: "Good" };       // amber
  if (n < 60) return { label: "Good", hex: "#2563eb", lower: 25, next: 60, nextLabel: "Great job!" };    // blue
  return { label: "Great job!", hex: "#059669", lower: 60, next: null, nextLabel: null };                // green
}
const callsHex = (n: number) => callsTier(n).hex;

// Gentle count-up: 0→value on mount, old→new on change. Respects reduced motion.
function useCountUp(target: number, ms = 800) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === target) { setVal(target); from.current = target; return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(start + (target - start) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

// Time-of-day greeting, in the operator's *local* time (client-only so SSR/CSR
// agree → no hydration mismatch). Uses the browser's own clock so it matches
// the locally-bucketed stats below.
function useGreeting() {
  const [g, setG] = useState("");
  useEffect(() => {
    const h = new Date().getHours();
    setG(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return g;
}

function Sparkline({ series, hex }: { series: number[]; hex: string }) {
  const max = Math.max(1, ...series);
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden>
      {series.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full"
          style={{ height: `${Math.max(12, (v / max) * 100)}%`, background: i === series.length - 1 ? hex : `${hex}33` }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  metricKey, value, series, idx,
}: {
  metricKey: MetricKey; value: number; series: number[]; idx: number;
}) {
  const n = useCountUp(value);
  const base = META[metricKey];
  const isCalls = metricKey === "calls";
  const tier = isCalls ? callsTier(value) : null;
  const hex = tier ? tier.hex : base.hex;
  const Icon = base.Icon;

  const progress = tier
    ? tier.next ? Math.min(1, (value - tier.lower) / (tier.next - tier.lower)) : 1
    : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      {/* slim identity accent */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 transition-colors duration-500" style={{ background: hex }} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-500" style={{ background: `${hex}1a`, color: hex }}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <span className="text-sm font-medium text-muted-foreground">{base.label}</span>
        </div>
        {tier && (
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-500"
            style={{ color: hex, background: `${hex}1a` }}
          >
            {tier.label}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div
          className="text-6xl font-bold leading-none tracking-tight tabular-nums transition-colors duration-500"
          style={{ color: hex }}
          aria-label={`${base.label}: ${value} today${tier ? ` (${tier.label})` : ""}`}
        >
          {n}
        </div>
        <Sparkline series={series} hex={hex} />
      </div>

      {tier ? (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress * 100}%`, background: hex }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {tier.next ? `${tier.next - value} more to ${tier.nextLabel}` : "Top tier — outstanding! 🎉"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">today</p>
      )}
    </div>
  );
}

export function ActivityBoards({
  today: initialToday, days: initialDays, name,
}: {
  today: DayStat; days: DayStat[]; name?: string;
}) {
  const greet = useGreeting();

  // All counts must reset on the operator's local wall clock (he works US hours
  // from India), so re-fetch with the browser's timezone. The server-rendered
  // props (IST-bucketed) are the initial fallback for instant first paint;
  // once tz resolves, SWR refetches locally-bucketed numbers and also keeps
  // them live (refresh each minute).
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setTz(null);
    }
  }, []);

  const span = initialDays.length || 5;
  const { data } = useSWR<{ today: DayStat; days: DayStat[] }>(
    tz ? `/api/activity/stats?days=${span}&tz=${encodeURIComponent(tz)}` : null,
    fetcher,
    {
      fallbackData: { today: initialToday, days: initialDays },
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );
  const today = data?.today ?? initialToday;
  const days = data?.days ?? initialDays;

  const total = today.calls + today.emails + today.views;
  const chrono = [...days].reverse(); // oldest → today (for sparklines)

  const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", opts) : "";
  const todayLabel = fmtDate(today.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const sub =
    total === 0 ? "Let’s get the first one on the board."
      : total < 10 ? "Good start — keep the momentum going."
        : "Strong day. Keep pushing. 🔥";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {greet ? `${greet}, ` : ""}{name || "there"}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {todayLabel}{todayLabel ? " · " : ""}{sub}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((key, i) => (
          <MetricCard key={key} metricKey={key} idx={i} value={today[key]} series={chrono.map((d) => d[key])} />
        ))}
      </div>

      {days.length > 1 && (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <span className="text-sm font-medium">Last {days.length} days</span>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {ORDER.map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: k === "calls" ? callsHex(today.calls) : META[k].hex }} />
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
                  <tr key={d.date} className={`border-t ${isToday ? "bg-muted/40" : ""}`}>
                    <td className="px-5 py-2.5">
                      {isToday ? <span className="font-semibold">Today</span> : fmtDate(d.date, { weekday: "short", day: "2-digit", month: "short" })}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums" style={{ color: d.calls ? callsHex(d.calls) : undefined }}>
                      {d.calls}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{d.emails}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{d.views}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
