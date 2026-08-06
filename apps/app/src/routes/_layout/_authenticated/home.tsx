/**
 * Home — the dashboard for the person paying for this, not the person running it.
 *
 * Dan, on the 2026-08-04 call, asked for exactly three things: "who's opening
 * the emails, who's clicking on the emails, what's bouncing". He also said "I'm
 * a caveman, I don't know how to encrypt a PDF". He landed on /leads — a
 * 2,148-row operator list — beside a campaign wizard, a scheduled queue of
 * 1,148 follow-ups with cancel buttons, and pipeline settings. None of that is
 * his job. He is not the operator; VK and Afham are.
 *
 * So this page answers his three questions by name, shows him the email that is
 * actually going out, and offers no control that operates the machine. Every
 * knob stays where the operators already work: Outreach, Live Finder, Pipeline
 * settings.
 *
 * Named people, not percentages. "17 opened" is a statistic; "Jeffrey Smith at
 * Ardrey Kell opened three times" is a lead you can ring — and ringing them is
 * the thing Dan is actually good at.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import {
  type EngagementKind,
  leadgenEmailExtras,
  leadgenEmails,
} from "@/fetchers/leadgen/emails";
import { DoThisNow } from "@/components/leadgen/do-this-now";
import { LeadFunnel } from "@/components/leadgen/lead-funnel";
import { ProviderHealth } from "@/components/leadgen/provider-health";
import { SentVolume } from "@/components/leadgen/sent-volume";
import { useBrand } from "@/hooks/use-brand";

type AngleDetail = {
  key: string;
  name: string;
  steps: { subject: string; body: string; delay_after_prev_days: number }[];
};

function when(ts?: number | null) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const days = Math.floor((Date.now() - ts * 1000) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

function Headline({
  value,
  label,
  sub,
  tone,
}: {
  value: string | number;
  label: string;
  sub?: string;
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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`text-3xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-sm font-medium">{label}</div>
      {sub ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function RouteComponent() {
  const brand = useBrand();
  /*
   * Seeded from ?focus= so "Do this now" can link straight to the right
   * list. Without it the panel could only say "go and look" — one click
   * from the task to the names is the whole point.
   */
  const { focus } = useSearch({ strict: false }) as { focus?: EngagementKind };
  const [tab, setTab] = useState<EngagementKind>(focus ?? "opened");
  useEffect(() => {
    if (focus) setTab(focus);
  }, [focus]);

  const stats = useQuery({
    queryKey: ["leadgen", "email-stats"],
    queryFn: () => leadgenEmails.stats(7),
    staleTime: 60_000,
  });

  const people = useQuery({
    queryKey: ["leadgen", "engagement", tab],
    queryFn: () => leadgenEmailExtras.engagement(tab),
    staleTime: 60_000,
  });

  const angles = useQuery({
    queryKey: ["leadgen", "angles"],
    queryFn: () => leadgen.get<{ items: AngleDetail[] }>("/api/emails/angles"),
    staleTime: 10 * 60_000,
  });

  const [angleKey, setAngleKey] = useState<string>("");
  const list = angles.data?.items ?? [];
  const angle = list.find((a) => a.key === angleKey) ?? list[0];
  const [stepIndex, setStepIndex] = useState(0);
  /*
   * Two designs were approved and only one can be live at a time, so the
   * other was unreachable — not shown anywhere in the dashboard and not
   * comparable against the one going out. "" means whatever is being sent.
   */
  const [variant, setVariant] = useState<string>("");
  const step = angle?.steps?.[stepIndex];

  const preview = useQuery({
    queryKey: ["leadgen", "preview", angle?.key, stepIndex, variant],
    queryFn: () =>
      leadgenEmailExtras.preview({
        body: step?.body ?? "",
        angle: angle?.key ?? "",
        step_index: stepIndex,
        ...(variant ? { variant } : {}),
      }),
    enabled: Boolean(step?.body),
  });

  const w = stats.data?.window;
  const rows = people.data?.items ?? [];

  return (
    <Layout>
      <PageTitle title="Home" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">{brand.shortName || "Home"}</h1>
        <span className="text-xs text-muted-foreground">last 7 days</span>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl space-y-6">
          {/*
            What to do, before what happened. Everything below this reports;
            this decides.
          */}
          {/*
            Above everything. If lead-finding has stopped, no number below is
            worth reading and the reason belongs at the top of the page, not in
            a log nobody opens.
          */}
          <ProviderHealth />

          <DoThisNow />

          {/*
            Sending volume, per day, before any rate. "How many went out
            yesterday" is the first thing asked about this system every morning
            and the four cards below could not answer it — they are all
            seven-day figures, and a seven-day figure invites the reader to
            find a smaller number elsewhere and treat it as today's.
          */}
          {/*
            The leads BEFORE the emails. Home reported send performance and
            nothing about the pipeline feeding it, so a low send count read as
            a sending fault when it is almost always a supply one — 87% of
            leads have no person attached, and that is the whole explanation.
          */}
          <LeadFunnel />

          <SentVolume />

          {/* The three numbers Dan asked for, in the order he asked for them. */}
          {stats.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/*
                New people, not messages. `sent` is distinct first contacts;
                the follow-ups that go to them are counted separately and
                never folded in here.
              */}
              <Headline
                value={w?.sent ?? 0}
                label="New companies emailed"
                sub={`last 7 days · ${(w?.followups ?? 0).toLocaleString()} follow-ups on top`}
              />
              <Headline
                value={w?.opened ?? 0}
                label="Opened"
                sub={`${w?.open_rate ?? 0}% of everything delivered`}
                tone={(w?.opened ?? 0) > 0 ? "good" : undefined}
              />
              <Headline
                value={w?.clicked ?? 0}
                label="Clicked a link"
                sub={`${w?.click_rate ?? 0}%`}
                tone={(w?.clicked ?? 0) > 0 ? "good" : undefined}
              />
              <Headline
                value={w?.bounced ?? 0}
                label="Bounced"
                sub={`${w?.bounce_rate ?? 0}% — under 5% is healthy`}
                tone={(w?.bounce_rate ?? 0) > 5 ? "bad" : "good"}
              />
            </div>
          )}

          {/*
            Named people. This is the section Dan will actually use: he closes
            deals on the phone, so a company that opened three times is a call to
            make, not a number to admire.
          */}
          <section className="rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="text-sm font-semibold">Who's paying attention</h2>
              <div className="ms-auto flex gap-1">
                {(["opened", "clicked", "bounced"] as EngagementKind[]).map(
                  (k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTab(k)}
                      className={`rounded-md px-2.5 py-1 text-xs capitalize ${
                        tab === k
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {k}
                    </button>
                  ),
                )}
              </div>
            </header>

            {people.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-40" />
              </div>
            ) : !rows.length ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {tab === "bounced"
                  ? "Nothing has bounced. That is the good outcome."
                  : `Nobody has ${tab} an email yet.`}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.slice(0, 25).map((r, i) => {
                  const row = r as Record<string, unknown>;
                  const opens = Number(row.open_count ?? 0);
                  const clicks = Number(row.click_count ?? 0);
                  return (
                    <li
                      key={`${row.id ?? i}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm"
                    >
                      <span className="font-medium">
                        {String(row.person_name || row.company || row.to_email)}
                      </span>
                      {row.person_name && row.company ? (
                        <span className="text-muted-foreground">
                          {String(row.company)}
                        </span>
                      ) : null}
                      <a
                        href={`mailto:${String(row.to_email)}`}
                        className="text-xs text-muted-foreground underline underline-offset-2"
                      >
                        {String(row.to_email)}
                      </a>
                      <span className="ms-auto flex items-center gap-3 text-xs">
                        {tab === "bounced" ? (
                          <span className="text-red-500">
                            {String(row.bounce_info ?? "bounced")}
                          </span>
                        ) : (
                          <>
                            {opens ? (
                              <span className="text-emerald-500">
                                opened {opens}×
                              </span>
                            ) : null}
                            {clicks ? (
                              <span className="text-emerald-500">
                                clicked {clicks}×
                              </span>
                            ) : null}
                          </>
                        )}
                        <span className="text-muted-foreground">
                          {when(
                            (row.first_open_at ??
                              row.click_at ??
                              row.bounce_at ??
                              row.sent_at) as number | null,
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/*
            The email itself, on the front page.

            It was reachable only by opening a lead and scrolling — so the
            question "what are we actually sending?" had no answer anywhere a
            client would look. Rendered through the production template, so this
            is the mail, not an impression of it.
          */}
          <section className="rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <h2 className="text-sm font-semibold">What we're sending</h2>
              <select
                value={angle?.key ?? ""}
                onChange={(e) => {
                  setAngleKey(e.target.value);
                  setStepIndex(0);
                }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                {list.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
              {/* Both approved designs, with the live one marked below. */}
              <div className="flex gap-1">
                {[
                  { key: "", label: "As sent" },
                  { key: "frame1", label: "Frame 1 · left" },
                  { key: "frame2", label: "Frame 2 · centred" },
                ].map((v) => (
                  <button
                    key={v.key || "live"}
                    type="button"
                    onClick={() => setVariant(v.key)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      variant === v.key
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="ms-auto flex flex-wrap gap-1">
                {(angle?.steps ?? []).map((st, i) => (
                  <button
                    key={st.subject + String(i)}
                    type="button"
                    onClick={() => setStepIndex(i)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      i === stepIndex
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {i === 0 ? "First email" : `Follow-up ${i}`}
                  </button>
                ))}
              </div>
            </header>
            <div className="p-4">
              {step?.subject ? (
                <div className="mb-2 text-sm">
                  <span className="text-muted-foreground">Subject: </span>
                  <span className="font-medium">{step.subject}</span>
                </div>
              ) : null}
              {angles.isLoading || preview.isLoading ? (
                <Skeleton className="h-[28rem]" />
              ) : (
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.data?.html ?? ""}
                  className="h-[28rem] w-full rounded-lg border border-border bg-white"
                />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Ten versions rotate across companies, each with its own follow-up
                sequence. Every company is written to by name.
                {preview.data?.live_variant ? (
                  <>
                    {" "}Currently sending{" "}
                    <strong className="text-foreground">
                      {preview.data.live_variant === "frame2"
                        ? "Frame 2 (centred)"
                        : "Frame 1 (left-aligned)"}
                    </strong>
                    {" "}— switch it in Pipeline settings.
                  </>
                ) : null}
              </p>
            </div>
          </section>

          <p className="pb-2 text-center text-xs text-muted-foreground">
            Running the campaigns lives in{" "}
            <Link to="/emails" className="underline underline-offset-2">
              Outreach
            </Link>
            .
          </p>
        </div>
      </div>
    </Layout>
  );
}

type HomeSearch = { focus?: EngagementKind };

export const Route = createFileRoute("/_layout/_authenticated/home")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const f = search.focus;
    return f === "opened" || f === "clicked" || f === "bounced"
      ? { focus: f }
      : {};
  },
});
