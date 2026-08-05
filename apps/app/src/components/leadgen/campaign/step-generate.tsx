/**
 * Step 4 — draft the whole run. Nothing is sent here.
 *
 * This step is the reason the wizard exists. Generation used to be fused to
 * sending, so there was never a moment when 200 drafts existed to be checked;
 * the first time anyone saw an email was in the Sent log, after it had gone.
 *
 * Progress polls campaign/status. `phase` distinguishes generating from
 * sending, so a half-finished generate can never be read as a half-finished
 * send — which, on a screen with a progress bar, is exactly the mistake that
 * would be made.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { type CampaignStatus, leadgenEmails } from "@/fetchers/leadgen/emails";
import { toast } from "@/lib/toast";
import type { CampaignDraft } from "./types";

export function StepGenerate({
  draft,
  status,
  onDone,
}: {
  draft: CampaignDraft;
  status?: CampaignStatus;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const running = status?.status === "running";
  const generating = running && status?.phase === "generating";
  const made = status?.generated ?? 0;
  const noPool = (status?.pool_remaining ?? null) === 0;
  const target = status?.generate_total || draft.total;

  // Poll only while something is happening — a wizard step that polls an idle
  // endpoint every two seconds for as long as it is open is pure noise.
  useQuery({
    queryKey: ["leadgen", "campaign-status"],
    queryFn: leadgenEmails.campaignStatus,
    refetchInterval: running ? 2_000 : false,
  });

  const generate = useMutation({
    mutationFn: () =>
      leadgenEmails.campaignGenerate({ total: draft.total, angle: draft.angle }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["leadgen", "campaign-status"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const stop = useMutation({
    mutationFn: leadgenEmails.campaignStop,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["leadgen", "campaign-status"] }),
  });

  const finished =
    !running && made > 0 && status?.phase === "idle" && Boolean(status?.message);

  const pct = target ? Math.min(100, Math.round((made / target) * 100)) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Draft the run</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Writes {draft.total} sequences — an opener and three follow-ups each —
          and puts them in the queue for review.{" "}
          <strong className="text-foreground">Nothing is sent by this step.</strong>
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="tabular-nums font-semibold">{made}</span>
            <span className="text-muted-foreground"> / {target} drafted</span>
          </div>
          {status?.invalid ? (
            <span className="text-xs text-muted-foreground">
              {status.invalid} dead addresses skipped
            </span>
          ) : null}
          <div className="ms-auto flex gap-2">
            {generating ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => stop.mutate()}
                disabled={stop.isPending}
              >
                {stop.isPending ? "Stopping…" : "Stop"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => generate.mutate()}
                /*
                 * Also refuses an empty pool here, not only on the Audience
                 * step. The pool can drain between steps — another run, or the
                 * suppression rules moving — and starting a job that can only
                 * draft zero wastes a round trip and reports a failure that is
                 * not one.
                 */
                disabled={generate.isPending || running || noPool}
              >
                {generate.isPending
                  ? "Starting…"
                  : made > 0
                    ? "Draft more"
                    : `Draft ${draft.total}`}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-1.5 rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        {noPool && !running ? (
          <p className="mt-2 text-xs text-amber-600">
            No leads with a named contact are available. Run contact-finding
            first — Pipeline settings → Enrichment.
          </p>
        ) : status?.message ? (
          <p className="mt-2 text-xs text-muted-foreground">{status.message}</p>
        ) : null}
      </div>

      {finished ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="text-sm">
            {made} drafts ready. Nothing has been sent yet.
          </p>
          <Button size="sm" className="ms-auto" onClick={onDone}>
            Review them
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default StepGenerate;
