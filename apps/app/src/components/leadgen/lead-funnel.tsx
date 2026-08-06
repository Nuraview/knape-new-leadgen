/**
 * Where the leads are, and where they stop.
 *
 * Home reported email performance and nothing else, so "we found 800 schools
 * today" and "we can send 39 emails" sat on the same screen with no visible
 * relationship. They have a very strong one: 87% of the leads have no person
 * attached, and that single fact explains every send number on the page.
 *
 * Each stage shows what it converts from the one above it. A raw count invites
 * "we have 3,748 leads"; a conversion says "and 12% of them are reachable",
 * which is the sentence that decides what to do next. The narrowest step is
 * named outright, because a funnel that makes you find the problem yourself is
 * a chart, not an answer.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";

type Stage = {
  key: string;
  label: string;
  value: number;
  of_previous: number;
};

type Funnel = {
  stages: Stage[];
  ready_to_email: number;
  website_no_email: number;
  bottleneck: { stage: string; detail: string };
  scraper?: {
    enabled?: boolean;
    times?: string;
    next_run_at?: number | null;
    last_run_at?: number | null;
    last_result?: { total?: number; ran_at?: number } | null;
  } | null;
};

function when(ts?: number | null): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() / 1000 - ts) / 60);
  if (mins < 0) return `in ${Math.abs(Math.round(mins / 60))}h`;
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function until(ts?: number | null): string {
  if (!ts) return "";
  const mins = Math.round((ts - Date.now() / 1000) / 60);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}

export function LeadFunnel() {
  const { data, isLoading } = useQuery({
    queryKey: ["leadgen", "leads-funnel"],
    queryFn: () => leadgen.get<Funnel>("/api/leads/funnel"),
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  if (isLoading) return <Skeleton className="h-52" />;
  if (!data) return null;

  const top = data.stages[0]?.value || 1;
  const s = data.scraper;

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">Finding companies</h2>
        <span className="text-xs text-muted-foreground">
          what the outreach is built from
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {s?.enabled ? (
            <>
              Runs at {s.times || "03:00,15:00"} · last {when(s.last_run_at)}
              {s.next_run_at ? ` · next ${until(s.next_run_at)}` : ""}
            </>
          ) : (
            <span className="text-amber-500">
              Automatic finding is switched off
            </span>
          )}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {data.stages.map((st, i) => {
          const width = Math.max(2, Math.round((st.value / top) * 100));
          return (
            <li key={st.key}>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="w-52 shrink-0 truncate">{st.label}</span>
                <strong className="tabular-nums">
                  {st.value.toLocaleString()}
                </strong>
                {i > 0 ? (
                  <span
                    className={`text-xs ${
                      st.of_previous < 50
                        ? "text-amber-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {st.of_previous}% of the step above
                  </span>
                ) : null}
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary/70"
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        The narrowest step, named. Without this the funnel is four numbers and
        an invitation to guess which one matters.
      */}
      {data.bottleneck.stage ? (
        <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600">
          <strong>The hold-up is {data.bottleneck.stage}.</strong>{" "}
          {data.bottleneck.detail}
          {data.website_no_email > 0 ? (
            <>
              {" "}
              {data.website_no_email.toLocaleString()} of them do have a website
              to read, which is where the next batch of contacts comes from.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          <strong className="tabular-nums text-foreground">
            {data.ready_to_email.toLocaleString()}
          </strong>{" "}
          ready to email now
        </span>
        <Link
          to="/leads"
          className="text-primary underline-offset-2 hover:underline"
        >
          See the leads
        </Link>
        <Link
          to="/pipeline-settings"
          className="text-primary underline-offset-2 hover:underline"
        >
          Finding settings
        </Link>
      </div>
    </section>
  );
}

export default LeadFunnel;
