/**
 * Events — trade-show lead pools (WEFTEC, WorkBoat, …).
 *
 * Each pool is the set of accounts a show contributed: exhibitors read from the
 * show's public directory, plus the client's own booth scans. They are tagged in
 * the cockpit with lead_source_bucket = "event:<slug>" and kept apart from the
 * main discovery pipeline, so this page is their own home rather than more rows
 * mixed into Leads.
 *
 * Two views in one route:
 *   - no ?pool  : an overview grid, one card per show, from GET /api/events.
 *   - ?pool=slug: that show's companies, from GET /api/accounts filtered to the
 *     event's data_batch. Each row opens the normal lead detail page, so the
 *     research, rating and outreach a lead already has are reused unchanged.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  Mail,
  Users,
} from "lucide-react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type { Account, AccountsResponse } from "@/fetchers/leadgen/types";

type EventPool = {
  bucket: string;
  slug: string;
  data_batch: string;
  name: string;
  total: number;
  with_contacts: number;
  with_email: number;
  with_website: number;
};

type EventsResponse = { pools: EventPool[] };

function cockpitHost(website: string): string {
  try {
    return new URL(website).host.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/** Overview: one card per show. */
function EventsOverview() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["events", "pools"],
    queryFn: () => leadgen.get<EventsResponse>("/api/events"),
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="p-5 text-sm text-destructive">
        Could not load events: {(error as Error).message}
      </p>
    );
  }

  const pools = data?.pools ?? [];
  if (pools.length === 0) {
    return (
      <div className="p-5 text-sm text-muted-foreground">
        <p>No event pools yet.</p>
        <p className="mt-2 max-w-prose">
          Collect a show's exhibitors or import a booth-scan file, then its pool
          appears here. See EVENT_LEADGEN.md in the leadgen app for the commands.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
      {pools.map((pool) => (
        <button
          key={pool.bucket}
          type="button"
          onClick={() => navigate({ to: "/events", search: { pool: pool.slug } })}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-start transition-colors hover:border-primary hover:bg-muted/40"
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            <span className="font-semibold text-base">{pool.name}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-semibold text-2xl">
              {pool.total.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">leads</span>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Website</dt>
              <dd className="font-medium">{pool.with_website.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Contacts</dt>
              <dd className="font-medium">{pool.with_contacts.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Emails</dt>
              <dd className="font-medium">{pool.with_email.toLocaleString()}</dd>
            </div>
          </dl>
        </button>
      ))}
    </div>
  );
}

/** Detail: the companies in one show's pool. */
function EventPoolDetail({ slug }: { slug: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["events", "pool", slug],
    queryFn: () =>
      leadgen.get<AccountsResponse>("/api/accounts", {
        data_batch: slug,
        min_icp: 0,
        page_size: 500,
      }),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3 sm:p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="p-5 text-sm text-destructive">
        Could not load this pool: {(error as Error).message}
      </p>
    );
  }

  const accounts: Account[] =
    data && data.mode === "accounts" ? data.items : [];

  if (accounts.length === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No leads in this pool yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {accounts.map((a) => (
        <li key={a.id}>
          <Link
            to="/pipeline/$accountId"
            params={{ accountId: String(a.id) }}
            className="flex items-center gap-3 px-3 py-3 hover:bg-muted/40 sm:px-5"
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{a.company}</div>
              {a.signal_evidence ? (
                <div className="truncate text-sm text-muted-foreground">
                  {a.signal_evidence}
                </div>
              ) : null}
            </div>
            {a.website ? (
              <a
                href={a.website}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hidden items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:flex"
              >
                {cockpitHost(a.website)}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="size-3.5" />
              {a.contacts_count ?? 0}
            </span>
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Mail className="size-3.5" />
              {a.emails_count ?? 0}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EventsPage() {
  const { pool } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <Layout>
      <PageTitle title={pool ? "Events" : "Events"} />

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-5">
        <SidebarTrigger className="-ms-1" />
        {pool ? (
          <button
            type="button"
            onClick={() => navigate({ to: "/events", search: {} })}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            Events
          </button>
        ) : (
          <h1 className="min-w-0 truncate font-semibold text-lg sm:text-xl">
            Events
          </h1>
        )}
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {pool ? <EventPoolDetail slug={pool} /> : <EventsOverview />}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/events")({
  component: EventsPage,
  validateSearch: (raw: Record<string, unknown>): { pool?: string } => ({
    pool: typeof raw.pool === "string" && raw.pool.trim() ? raw.pool : undefined,
  }),
});
