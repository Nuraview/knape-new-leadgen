/**
 * Inbound — leads that came to us, ported from the cockpit's Inbound tab.
 *
 * These are website form submissions captured by the public endpoint with a
 * honeypot field and a per-IP rate limit. They are the warmest leads in the
 * system and are kept apart from the scraped pipeline for exactly that reason.
 *
 * The CSV export is carried over deliberately: it is how the list gets handed
 * to anyone who does not have a CRM login.
 *
 * The three organisation columns are stored under the field names the capture
 * endpoint was first written for — `school`, `students_count`, `school_type`.
 * Those are wire names now, not labels: renaming the columns would mean a
 * migration on live rows for no gain, so the LABELS are neutral and the keys
 * are left where they are.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type { SampleLead } from "@/fetchers/leadgen/types";
import useBrand from "@/hooks/use-brand";

const COLUMNS: { key: keyof SampleLead; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "school", label: "Organisation" },
  { key: "role", label: "Role" },
  { key: "students_count", label: "Size" },
  { key: "school_type", label: "Segment" },
  { key: "source", label: "Source" },
];

function toCsv(rows: SampleLead[]): string {
  const header = [...COLUMNS.map((c) => c.label), "Grant interest", "Received"];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Quote whenever the value could break a cell — notes routinely contain
    // commas and newlines.
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      ...COLUMNS.map((c) => escape(r[c.key])),
      escape(r.grant_interest ? "yes" : "no"),
      escape(new Date(r.created_at * 1000).toISOString()),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function RouteComponent() {
  const brand = useBrand();
  // Hostname only — the empty state is a sentence, and a full URL with its
  // scheme and trailing slash reads as a pasted link in the middle of one.
  const marketingHost = brand.marketingUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "sample-leads"],
    queryFn: () =>
      leadgen.get<{ items?: SampleLead[] } | SampleLead[]>("/api/sample-leads"),
    refetchInterval: 60_000,
  });

  const rows: SampleLead[] = Array.isArray(data) ? data : (data?.items ?? []);

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inbound-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <PageTitle title="Inbound" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Inbound</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length ? `${rows.length} enquiries` : ""}
        </span>
        <Button
          className="ms-auto"
          variant="outline"
          onClick={download}
          disabled={!rows.length}
        >
          <Download className="size-4" />
          Export CSV
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-500">{String(error as Error)}</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No website enquiries yet. These arrive from the enquiry forms on{" "}
            {marketingHost}.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">
                    Grant
                  </th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        {c.key === "email" && r.email ? (
                          <a
                            href={`mailto:${r.email}`}
                            className="underline underline-offset-2"
                          >
                            {r.email}
                          </a>
                        ) : (
                          String(r[c.key] ?? "—")
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {r.grant_interest ? (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-500">
                          interested
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {new Date(r.created_at * 1000).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/inbound")({
  component: RouteComponent,
});
