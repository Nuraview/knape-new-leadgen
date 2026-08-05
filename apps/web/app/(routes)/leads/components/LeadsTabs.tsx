"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deriveScraperAlert, type HealthLite } from "@/lib/scraper-alert";
import { LeadsList } from "./LeadsList";
import { ScraperHealth } from "./ScraperHealth";
import { StatsBar } from "./StatsBar";

type Status = { id: string; name: string };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

/**
 * The colored dot on the "System Health" tab. Color + pulse communicates
 * severity at a glance; tooltip carries the specific reason.
 */
function AlertDot({
  level,
  reason,
}: {
  level: "none" | "info" | "warn" | "critical";
  reason: string;
}) {
  if (level === "none") return null;
  const className =
    level === "critical"
      ? "bg-red-500 animate-pulse"
      : level === "warn"
        ? "bg-amber-500"
        : "bg-blue-500";
  return (
    <span
      className={`ml-1 inline-block h-2 w-2 rounded-full ${className}`}
      title={reason}
      aria-label={reason}
    />
  );
}

export function LeadsTabs({ statuses }: { statuses: Status[] }) {
  const { data } = useSWR<HealthLite>("/api/scraper/health", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });
  const alert = useMemo(() => deriveScraperAlert(data), [data]);

  return (
    <Tabs defaultValue="leads" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="leads">Leads</TabsTrigger>
        <TabsTrigger value="health" className="flex items-center">
          <span>System Health</span>
          <AlertDot level={alert.level} reason={alert.reason} />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="leads" className="mt-0">
        <LeadsList statuses={statuses} />
      </TabsContent>

      <TabsContent value="health" className="mt-0 space-y-4">
        <StatsBar />
        <ScraperHealth />
      </TabsContent>
    </Tabs>
  );
}
