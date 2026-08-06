/**
 * Step 2 — which of the ten angles, and what it actually says.
 *
 * "What kind of email are we sending?" is answered HERE, before anything is
 * drafted. Each angle arrives from the cockpit already rendered against a
 * sample lead, so choosing one shows the real opener and the real follow-up
 * ladder rather than a name in a dropdown.
 *
 * Auto-rotate stays the default. pick_angle is deterministic per account, so a
 * rotated run still attributes cleanly in the per-angle A/B table; locking to
 * one is for when you want a straight comparison instead.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import { leadgenEmailExtras } from "@/fetchers/leadgen/emails";
import type { CampaignDraft } from "./types";

type AngleStep = {
  subject: string;
  body: string;
  delay_after_prev_days: number;
};
type AngleDetail = { key: string; name: string; steps: AngleStep[] };

export function StepMessage({
  draft,
  onChange,
}: {
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  const angles = useQuery({
    queryKey: ["leadgen", "angles"],
    queryFn: () =>
      leadgen.get<{ items: AngleDetail[] }>("/api/emails/angles"),
    staleTime: 10 * 60_000,
  });

  const list = angles.data?.items ?? [];
  // With auto-rotate there is no single angle to show, so preview the first as
  // a representative rather than showing nothing at all.
  const shown = list.find((a) => a.key === draft.angle) ?? list[0];
  const step = shown?.steps?.[stepIndex];

  const preview = useQuery({
    queryKey: ["leadgen", "preview", shown?.key, stepIndex],
    queryFn: () =>
      leadgenEmailExtras.preview({
        body: step?.body ?? "",
        angle: shown?.key ?? "",
        step_index: stepIndex,
      }),
    enabled: Boolean(step?.body),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">What are we sending?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ten angles, each with its own opener, follow-up ladder and designed
          creative. Previewed against a sample lead — the real ones are
          personalised per company.
        </p>
      </div>

      {angles.isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onChange({ angle: null })}
              className={`block w-full rounded-md border p-2.5 text-left text-sm ${
                draft.angle === null
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="font-medium">Auto-rotate all ten</div>
              <div className="text-xs text-muted-foreground">
                Each company gets the angle that suits it, chosen the same way
                every time so results stay attributable. Recommended.
              </div>
            </button>

            <div className="max-h-80 space-y-1.5 overflow-y-auto pe-1">
              {list.map((a) => (
                <button
                  type="button"
                  key={a.key}
                  onClick={() => {
                    onChange({ angle: a.key });
                    setStepIndex(0);
                  }}
                  className={`block w-full rounded-md border p-2 text-left text-xs ${
                    draft.angle === a.key
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="font-medium">{a.name}</div>
                  <div className="truncate text-muted-foreground">
                    {a.steps?.[0]?.subject}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            {shown ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {shown.steps.map((st, i) => (
                    <button
                      type="button"
                      key={st.subject + String(i)}
                      onClick={() => setStepIndex(i)}
                      className={`rounded px-2 py-0.5 text-xs ${
                        i === stepIndex
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      }`}
                    >
                      {i === 0 ? "Opener" : `+${st.delay_after_prev_days}d`}
                    </button>
                  ))}
                  {draft.angle === null ? (
                    <span className="ms-1 text-xs text-muted-foreground">
                      sample of one of the ten
                    </span>
                  ) : null}
                </div>
                {step?.subject ? (
                  <div className="mb-1.5 truncate text-xs">
                    <span className="text-muted-foreground">Subject: </span>
                    {step.subject}
                  </div>
                ) : null}
                {preview.isLoading ? (
                  <Skeleton className="h-80" />
                ) : (
                  <iframe
                    title="Angle preview"
                    sandbox=""
                    srcDoc={preview.data?.html ?? ""}
                    className="h-80 w-full rounded-md border border-border bg-white"
                  />
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default StepMessage;
