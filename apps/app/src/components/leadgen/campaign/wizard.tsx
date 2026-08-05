/**
 * The campaign wizard — five steps, one decision each.
 *
 * Replaces a single dense card that asked for total, batch size and interval
 * side by side and then did everything at once behind one Start button. There
 * was no order to follow and no point at which anything could be checked.
 *
 * Step lives in component state rather than the URL for now: the run itself is
 * server-side (campaign/status survives a reload and the drafts are in the
 * queue either way), so a refresh loses only which panel was open, not work.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { leadgenEmails } from "@/fetchers/leadgen/emails";
import { StepAudience } from "./step-audience";
import { StepGenerate } from "./step-generate";
import { StepMessage } from "./step-message";
import { StepReview } from "./step-review";
import { StepSchedule } from "./step-schedule";
import { type CampaignDraft, DEFAULT_DRAFT, STEPS, type StepKey } from "./types";

export function CampaignWizard({ onSent }: { onSent: () => void }) {
  const [step, setStep] = useState<StepKey>("audience");
  const [draft, setDraft] = useState<CampaignDraft>(DEFAULT_DRAFT);

  const status = useQuery({
    queryKey: ["leadgen", "campaign-status"],
    queryFn: leadgenEmails.campaignStatus,
    staleTime: 15_000,
  });

  const index = STEPS.findIndex((s) => s.key === step);
  const patch = (p: Partial<CampaignDraft>) =>
    setDraft((d) => ({ ...d, ...p }));

  /*
   * Can this step be left?
   *
   * Clamping the Audience input was not enough on its own — Continue stayed
   * live with a pool of zero, so the wizard would walk all the way to Generate
   * and start a run that could only draft nothing. A step that cannot produce a
   * valid campaign should not advance.
   */
  const pool = status.data?.pool_remaining ?? null;
  const blocked: string | null =
    step === "audience"
      ? pool === 0
        ? "No leads with a named contact are available to draft."
        : draft.total < 1
          ? "Choose how many to draft."
          : pool !== null && draft.total > pool
            ? `Only ${pool} available — lower the number.`
            : null
      : step === "schedule"
        ? draft.batchSize < 1
          ? "Batch size must be at least 1."
          : draft.batchSize > draft.total
            ? "Batch size cannot exceed the number being drafted."
            : null
        : null;

  const go = (i: number) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))];
    if (next) setStep(next.key);
  };

  return (
    <div className="space-y-5">
      {/* The stepper. Earlier steps stay clickable — going back to change the
          angle after seeing the drafts is a normal thing to want. */}
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {STEPS.map((s, i) => {
          const done = i < index;
          const now = i === index;
          return (
            <li key={s.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => go(i)}
                disabled={i > index}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                  now
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground"
                } ${i > index ? "cursor-default" : ""}`}
              >
                <span
                  className={`grid size-4 place-items-center rounded-full text-[10px] ${
                    now
                      ? "bg-primary-foreground text-primary"
                      : done
                        ? "bg-emerald-500 text-white"
                        : "bg-muted"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="text-muted-foreground/40">
                  —
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border border-border bg-card p-4">
        {step === "audience" ? (
          <StepAudience
            status={status.data}
            draft={draft}
            onChange={patch}
          />
        ) : step === "message" ? (
          <StepMessage draft={draft} onChange={patch} />
        ) : step === "schedule" ? (
          <StepSchedule draft={draft} onChange={patch} />
        ) : step === "generate" ? (
          <StepGenerate
            draft={draft}
            status={status.data}
            onDone={() => setStep("review")}
          />
        ) : (
          <StepReview onSent={onSent} />
        )}
      </div>

      {/* Generate and Review own their own actions — a generic "Next" beside a
          "Send all 200" is how the wrong button gets pressed. */}
      {step !== "generate" && step !== "review" ? (
        <div className="flex items-center gap-2">
          {index > 0 ? (
            <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
              Back
            </Button>
          ) : null}
          {blocked ? (
            <span className="ms-auto text-xs text-amber-600">{blocked}</span>
          ) : null}
          <Button
            size="sm"
            className={blocked ? "" : "ms-auto"}
            disabled={Boolean(blocked)}
            onClick={() => go(index + 1)}
          >
            Continue
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

export default CampaignWizard;
