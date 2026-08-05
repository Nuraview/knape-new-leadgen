"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Phone, Mail, Eye, type LucideIcon } from "lucide-react";
import useSWR from "swr";

// Big, loud "Today" outreach panel for the sidebar's middle space (client ask,
// Jun 2026: "there's still too much space — make it bigger and as obnoxiously
// obvious as possible / catch the client's attention"). It deliberately GROWS
// to fill the empty area (flex-1) so there's no dead gap, and uses oversized
// count-up numbers + identity colours so the rep can't miss it. Links to the
// full Activity scoreboard.
//
// Hidden in icon-collapsed mode (group-data-[collapsible=icon]:hidden), same
// as the other label-bearing sidebar chrome.

type DayStat = { date: string; calls: number; emails: number; views: number };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

// Identity colours + icons kept in sync with the Activity dashboard
// (ActivityBoards META): calls = red, emails = indigo, views = purple.
const ROWS: Array<{
  key: keyof Omit<DayStat, "date">;
  label: string;
  Icon: LucideIcon;
  hex: string;
}> = [
  { key: "calls", label: "Calls made", Icon: Phone, hex: "#ef4444" },
  { key: "emails", label: "Emails sent", Icon: Mail, hex: "#4f46e5" },
  { key: "views", label: "Projects viewed", Icon: Eye, hex: "#7c3aed" },
];

// Gentle 0→value count-up so a fresh number visibly ticks up and draws the
// eye. Respects reduced-motion. (Mirrors the dashboard's useCountUp.)
function useCountUp(target: number, ms = 700) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === target) {
      setVal(target);
      from.current = target;
      return;
    }
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

function MetricTile({
  value,
  label,
  Icon,
  hex,
}: {
  value: number | null;
  label: string;
  Icon: LucideIcon;
  hex: string;
}) {
  const shown = useCountUp(value ?? 0);
  return (
    <div
      className="flex flex-1 items-center gap-3 rounded-xl border-l-4 px-4 py-3"
      style={{ backgroundColor: `${hex}14`, borderLeftColor: hex }}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${hex}26`, color: hex }}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-sidebar-foreground/80">
        {label}
      </span>
      <span
        className="text-4xl font-extrabold leading-none tabular-nums"
        style={{ color: hex }}
      >
        {value === null ? "–" : shown}
      </span>
    </div>
  );
}

export function NavActivityToday() {
  // Today's counts must reset on the operator's local wall clock (he works US
  // hours from India), so pass the browser's timezone to the API — all three
  // metrics get bucketed in it. Resolved after mount to avoid SSR using the
  // server's timezone.
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setTz(null);
    }
  }, []);

  const { data } = useSWR<{ today: DayStat }>(
    tz
      ? `/api/activity/stats?tz=${encodeURIComponent(tz)}`
      : "/api/activity/stats",
    fetcher,
    {
      // Live scoreboard — keep it fresh without being chatty.
      refreshInterval: 60_000,
      revalidateOnFocus: true,
    },
  );
  const today = data?.today ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 group-data-[collapsible=icon]:hidden">
      <Link
        href="/activity"
        className="flex h-full flex-col rounded-2xl border border-sidebar-border bg-sidebar-accent/30 p-4 transition-colors hover:bg-sidebar-accent"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold uppercase tracking-wide text-sidebar-foreground">
            Today&apos;s Activity
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            View all →
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-3">
          {ROWS.map(({ key, label, Icon, hex }) => (
            <MetricTile
              key={key}
              value={today ? today[key] : null}
              label={label}
              Icon={Icon}
              hex={hex}
            />
          ))}
        </div>
      </Link>
    </div>
  );
}
