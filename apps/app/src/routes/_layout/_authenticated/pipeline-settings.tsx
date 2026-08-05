/**
 * Pipeline settings — the cockpit's own settings registry, ported.
 *
 * Every knob carries a label and a help string written for a non-technical
 * owner, and the server states where each value came from (`source`: db, env or
 * default). That is deliberate on the Python side and worth preserving: the
 * point of this screen is that Dan can change how his own lead-finding behaves
 * without asking anyone.
 *
 * Four groups: Scraper, Enrichment, Outreach, Keys. The Keys group holds API
 * credentials the owner can paste to override the server's, which is also why
 * secrets are write-only here — the API returns them masked and this never
 * tries to display one.
 *
 * Vendor credit alerts are shown at the top because an exhausted key is
 * indistinguishable from "the scraper found nothing" — and right now Serper is
 * reporting exactly that.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ProviderHealth } from "@/components/leadgen/provider-health";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";

type SettingType =
  | "bool"
  | "int"
  | "float"
  | "str"
  | "secret"
  | "states"
  | "times";

type Setting = {
  key: string;
  group: string;
  type: SettingType;
  label: string;
  help?: string;
  default?: unknown;
  value?: unknown;
  /** db | env | default — where the effective value came from. */
  source?: string;
};

type SettingsResponse = {
  items: Setting[];
  schedule?: Record<string, unknown> | null;
  key_alerts?: Record<string, { message?: string } | null> | null;
};

const GROUP_ORDER = ["Scraper", "Enrichment", "Outreach", "Keys"];

function RouteComponent() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "settings"],
    queryFn: () => leadgen.get<SettingsResponse>("/api/settings"),
  });

  const save = useMutation({
    /*
     * The cockpit expects { values: {...}, reset: [...] }, not a flat object.
     *
     * This was sending the draft flat. Pydantic ignores unknown top-level keys,
     * so `values` fell back to {}, set_settings() was never called, and the
     * endpoint answered 200 {"ok":true,"saved":{}} — a successful-looking
     * response that saved nothing. Every toggle on this page silently no-opped,
     * which is why auto-scrape kept reverting to off and why the scraper had
     * never run once in the life of the instance.
     */
    mutationFn: (patch: Record<string, unknown>) =>
      leadgen.patch("/api/settings", { values: patch }),
    onSuccess: () => {
      setDraft({});
      qc.invalidateQueries({ queryKey: ["leadgen", "settings"] });
    },
  });

  const items = data?.items ?? [];
  const dirty = Object.keys(draft).length > 0;

  const set = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** Unsaved edit if there is one, else the server's effective value. */
  const valueOf = (s: Setting) =>
    s.key in draft ? draft[s.key] : (s.value ?? s.default);

  return (
    <Layout>
      <PageTitle title="Pipeline settings" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Pipeline settings</h1>
        {dirty ? (
          <div className="ms-auto flex gap-2">
            <Button variant="outline" onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
              {save.isPending
                ? "Saving…"
                : `Save ${Object.keys(draft).length} change${Object.keys(draft).length > 1 ? "s" : ""}`}
            </Button>
          </div>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-6">
          {/*
            Was a dump of raw provider errors:
            `serper: HTTP 400: {"message":"Not enough credits","statusCode":400}`
            four times over, in amber, at the top of the page. That tells a
            developer something and tells the client nothing except that
            something is broken — and it stayed amber while Bright Data was
            quietly carrying the whole pipeline, so it was alarming AND wrong.
            ProviderHealth says what stops working and stays quiet when a
            fallback has it covered.
          */}
          <ProviderHealth />

          {save.error ? (
            <p className="text-sm text-red-500">{String(save.error as Error)}</p>
          ) : null}

          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">{String(error as Error)}</p>
          ) : (
            GROUP_ORDER.filter((g) => items.some((i) => i.group === g)).map(
              (group) => (
                <section key={group}>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </h2>
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    {items
                      .filter((s) => s.group === group)
                      .map((s) => {
                        const v = valueOf(s);
                        return (
                          <div key={s.key} className="p-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">
                                  {s.label}
                                </div>
                                {s.help ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {s.help}
                                  </div>
                                ) : null}
                              </div>

                              {s.type === "bool" ? (
                                <input
                                  type="checkbox"
                                  checked={v === true || v === "true" || v === 1}
                                  onChange={(e) => set(s.key, e.target.checked)}
                                  className="size-4"
                                />
                              ) : s.type === "int" || s.type === "float" ? (
                                <input
                                  type="number"
                                  step={s.type === "float" ? "0.1" : "1"}
                                  value={String(v ?? "")}
                                  onChange={(e) =>
                                    set(
                                      s.key,
                                      s.type === "float"
                                        ? Number.parseFloat(e.target.value)
                                        : Number.parseInt(e.target.value, 10),
                                    )
                                  }
                                  className="h-9 w-28 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
                                />
                              ) : s.type === "secret" ? (
                                <input
                                  type="password"
                                  placeholder="•••••• set"
                                  onChange={(e) => set(s.key, e.target.value)}
                                  className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={String(v ?? "")}
                                  onChange={(e) => set(s.key, e.target.value)}
                                  placeholder={
                                    s.type === "times"
                                      ? "03:00,15:00"
                                      : s.type === "states"
                                        ? "TX,FL,GA — empty for all"
                                        : ""
                                  }
                                  className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
                                />
                              )}
                            </div>
                            {s.source && s.source !== "db" ? (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                currently from {s.source}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </section>
              ),
            )
          )}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/pipeline-settings")(
  { component: RouteComponent },
);
