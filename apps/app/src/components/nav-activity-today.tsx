/**
 * "TODAY'S ACTIVITY" sidebar panel.
 *
 * Ported from the legacy sidebar. Deliberately large and colour-coded — it
 * exists so a rep can see, without navigating anywhere, whether today's
 * outreach has actually happened. Identity colours match the Activity
 * dashboard: calls red, emails indigo, views purple.
 *
 * Counts reset on the operator's LOCAL day, not UTC — the team works US hours
 * from India, so the browser timezone is sent with the request.
 */
import { useQuery } from "@tanstack/react-query";
import { Eye, Mail, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { useMyAccess } from "@/hooks/queries/use-my-access";

type TodayActivity = {
  calls: number;
  emails: number;
  views: number;
  scope: "user" | "instance";
};

const ROWS = [
  { key: "calls", label: "Calls made", Icon: Phone, tint: "#ef4444" },
  { key: "emails", label: "Emails sent", Icon: Mail, tint: "#4f46e5" },
  { key: "views", label: "Projects viewed", Icon: Eye, tint: "#7c3aed" },
] as const;

/** 0→value count-up so a fresh number visibly ticks. Respects reduced-motion. */
function useCountUp(target: number, ms = 700) {
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

    const began = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / ms);
      // ease-out so it decelerates into the final number
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

function StatRow({
  label,
  value,
  Icon,
  tint,
}: {
  label: string;
  value: number;
  Icon: typeof Phone;
  tint: string;
}) {
  const shown = useCountUp(value);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border-s-4 px-3 py-2.5"
      style={{ borderInlineStartColor: tint, backgroundColor: `${tint}14` }}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: `${tint}26`, color: tint }}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span
        className="text-2xl font-bold tabular-nums"
        style={{ color: tint }}
      >
        {shown}
      </span>
    </div>
  );
}

export function NavActivityToday() {
  const { data: access } = useMyAccess();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data } = useQuery({
    queryKey: ["lead", "activity-today", timezone],
    queryFn: async (): Promise<TodayActivity> => {
      const response = await fetch(
        `${getApiUrl("lead/activity/today")}?tz=${encodeURIComponent(timezone)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load activity");
      return response.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Outreach counts come from the CRM database, which projects-only accounts
    // cannot read.
    enabled: access?.canAccessCrm === true,
  });

  if (!access?.canAccessCrm) return null;

  return (
    <div className="mx-2 mb-2 rounded-xl border border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
          Today's activity
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {ROWS.map(({ key, label, Icon, tint }) => (
          <StatRow
            key={key}
            label={label}
            value={data?.[key] ?? 0}
            Icon={Icon}
            tint={tint}
          />
        ))}
      </div>
    </div>
  );
}
