/**
 * When an outside service stops working, say so on the page.
 *
 * Every one of these failures was already being recorded. `record_key_alert`
 * has written to KEY_ALERTS on each quota error for weeks. Nothing ever read
 * it back onto a screen, so on 5 Aug all four search providers ran out of
 * credit within ninety minutes of each other, contact-finding went to zero,
 * the sendable pool fell to 34 out of 3,748 leads, and the first anyone knew
 * was someone asking why the send count looked low. Two people spent a morning
 * guessing at a number that a banner could have explained in a sentence.
 *
 * So this is deliberately loud when it matters and silent when it does not.
 * One provider out of credit is a fail-over, not an outage — showing a red bar
 * for it teaches people to ignore red bars. It shouts only when every search
 * provider is down, which is the state where no new lead can be found.
 *
 * The copy is impact-first. "Serper: HTTP 400 Not enough credits" tells a
 * developer something and tells Dan nothing. "No new contacts can be found"
 * tells them both, and the provider name is the detail underneath.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { leadgen } from "@/fetchers/leadgen/client";

type Provider = {
  key: string;
  label: string;
  impact: string;
  critical: boolean;
  state: "ok" | "down" | "missing";
  detail: string;
  at?: number | null;
};

type Spend = {
  provider: string;
  used_today: number;
  daily_budget: number;
  remaining: number;
  cached_answers: number;
};

type Health = {
  items: Provider[];
  spend?: Spend | null;
  ok: boolean;
  searching_broken: boolean;
  headline: string;
};

function ago(ts?: number | null): string {
  if (!ts) return "";
  const mins = Math.round((Date.now() / 1000 - ts) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function ProviderHealth() {
  const { data } = useQuery({
    queryKey: ["leadgen", "provider-health"],
    queryFn: () => leadgen.get<Health>("/api/providers/health"),
    // Five minutes. A credit balance does not change second to second, and a
    // banner that refetches constantly is its own kind of noise.
    refetchInterval: 300_000,
    staleTime: 120_000,
  });

  if (!data) return null;

  const spend = data.spend;
  const broken = data.items.filter((i) => i.state !== "ok");
  // Nothing broken and nothing near a budget: say nothing at all.
  const tight = spend ? spend.remaining < spend.daily_budget * 0.15 : false;
  if (!broken.length && !tight) return null;

  // Everything still works: something is degraded but a fallback covered it.
  // Worth stating, not worth alarming about.
  const degradedOnly = !data.searching_broken;

  return (
    <section
      className={`rounded-lg border p-4 ${
        degradedOnly
          ? "border-border bg-muted/30"
          : "border-red-500/50 bg-red-500/10"
      }`}
    >
      <div className="flex items-start gap-3">
        {degradedOnly ? (
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              degradedOnly ? "text-foreground" : "text-red-500"
            }`}
          >
            {data.headline ||
              `${broken.length} outside service${
                broken.length === 1 ? " is" : "s are"
              } not responding`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {degradedOnly
              ? "A backup is covering it, so nothing has stopped. Worth topping up before the one still working runs out too."
              : "Lead-finding has stopped until one of these is topped up. Emails already written will keep sending."}
          </p>

          <ul className="mt-3 space-y-1.5">
            {broken.map((p) => (
              <li key={p.key} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium">{p.label}</span>
                <span
                  className={
                    p.state === "missing"
                      ? "text-muted-foreground"
                      : "text-amber-500"
                  }
                >
                  {p.state === "missing" ? "no key set" : "out of credit"}
                </span>
                <span className="text-muted-foreground">— {p.impact}</span>
                {p.at ? (
                  <span className="text-muted-foreground/70">{ago(p.at)}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {/*
            Bright Data bills per call and is now the only provider carrying
            the pipeline, so what it has cost today belongs next to the reason
            it is carrying it. `cached_answers` is how many questions were
            answered for free — a repeat never reaches the provider.
          */}
          {spend ? (
            <p className={`mt-3 text-xs ${tight ? "text-amber-500" : "text-muted-foreground"}`}>
              Bright Data:{" "}
              <strong className="tabular-nums">{spend.used_today}</strong> of{" "}
              <span className="tabular-nums">{spend.daily_budget}</span> calls used
              today · <span className="tabular-nums">{spend.cached_answers}</span>{" "}
              answers served from cache at no cost
              {tight ? " · close to today's ceiling" : ""}
            </p>
          ) : null}

          <p className="mt-3 text-xs text-muted-foreground">
            Keys and the daily ceiling live in Pipeline settings → Keys.
          </p>
        </div>
      </div>
    </section>
  );
}

export default ProviderHealth;
