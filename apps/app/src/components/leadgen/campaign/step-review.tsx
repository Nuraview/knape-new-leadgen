/**
 * Step 5 — every drafted sequence, checkable, before any of it sends.
 *
 * This is the screen the dashboard never had. It answers all three of the
 * questions that could not be answered before:
 *
 *   "are all 200 generated?"        the count, and every row listed
 *   "what does each one say?"       subject, angle, and the production render
 *   "do they all have follow-ups?"  the ladder per row, and a total
 *
 * The list is GET /api/emails/approved, which already hydrates each sequence
 * with its steps — no new endpoint was needed for any of it.
 *
 * Deselecting a row and sending sends only the rest: /api/emails/send-approved
 * takes a subset of sequence_ids. A dropped row stays approved rather than
 * being deleted, so it is still there next time.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ApprovedSequence,
  leadgenEmails,
  leadgenEmailExtras,
} from "@/fetchers/leadgen/emails";
import { toast } from "@/lib/toast";

function when(ts?: number | null) {
  return ts ? new Date(ts * 1000).toLocaleDateString() : null;
}

export function StepReview({ onSent }: { onSent: () => void }) {
  const qc = useQueryClient();
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);

  const queue = useQuery({
    queryKey: ["leadgen", "approved"],
    queryFn: leadgenEmails.approved,
  });

  const items: ApprovedSequence[] = queue.data?.items ?? [];
  const keeping = items.filter((s) => !dropped.has(s.id));
  const totalSteps = keeping.reduce((n, s) => n + (s.steps?.length ?? 0), 0);
  const followUps = totalSteps - keeping.length;
  const capRemaining = queue.data?.cap_remaining ?? null;

  const opened = items.find((s) => s.id === openId);
  const openerBody = opened?.steps?.[0]?.body ?? "";

  const preview = useQuery({
    queryKey: ["leadgen", "preview", openId],
    queryFn: () =>
      leadgenEmailExtras.preview({
        body: openerBody,
        angle: opened?.angle ?? "",
        step_index: 0,
        from_email: opened?.from_email ?? "",
      }),
    enabled: Boolean(openerBody),
  });

  const send = useMutation({
    mutationFn: () => leadgenEmails.sendApproved(keeping.map((s) => s.id)),
    onSuccess: (r) => {
      toast.success(
        r?.detail ?? `${r?.result?.queued ?? keeping.length} sequences sending.`,
      );
      qc.invalidateQueries({ queryKey: ["leadgen"] });
      onSent();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (queue.isLoading) return <Skeleton className="h-96" />;

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">Nothing drafted yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Go back to Generate and draft a run first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {keeping.length} ready to send
          </h3>
          <p className="text-xs text-muted-foreground">
            {totalSteps} emails in total — {keeping.length} openers and{" "}
            {followUps} follow-ups already scheduled behind them.
            {capRemaining !== null
              ? ` ${capRemaining} can go out in the next 24 hours; the rest wait.`
              : ""}
          </p>
        </div>
        <Button
          className="ms-auto"
          disabled={send.isPending || !keeping.length}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Sending…" : `Send all ${keeping.length}`}
        </Button>
      </div>

      {dropped.size ? (
        <p className="text-xs text-muted-foreground">
          {dropped.size} removed from this send. They stay drafted and will be
          here next time.{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setDropped(new Set())}
          >
            Put them back
          </button>
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {items.map((s) => {
            const steps = s.steps ?? [];
            const out = dropped.has(s.id);
            return (
              <li
                key={s.id}
                className={`p-3 ${out ? "opacity-45" : ""} ${
                  openId === s.id ? "bg-muted/40" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!out}
                    onChange={() =>
                      setDropped((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                    aria-label={`Include ${s.company ?? s.to_email}`}
                  />
                  <span className="font-medium">{s.company || s.to_email}</span>
                  <span className="text-muted-foreground">{s.to_email}</span>
                  {s.angle ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {s.angle}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOpenId(s.id)}
                    className="ms-auto text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                  >
                    preview
                  </button>
                </div>
                {steps[0]?.subject ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {steps[0].subject}
                  </div>
                ) : null}
                {/* The follow-up ladder, per row. "Do all 200 have follow-ups"
                    is answered by being able to see it on every line. */}
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  {steps.length <= 1 ? (
                    <span className="text-amber-600">no follow-ups</span>
                  ) : (
                    steps.slice(1).map((st, i) => (
                      <span
                        key={st.id ?? i}
                        className="rounded bg-muted px-1.5 py-0.5"
                      >
                        +{st.delay_after_prev_days ?? "?"}d
                        {when(st.scheduled_at) ? ` · ${when(st.scheduled_at)}` : ""}
                      </span>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="min-w-0">
          {opened ? (
            <>
              <div className="mb-1.5 truncate text-xs">
                <span className="text-muted-foreground">Opener: </span>
                {opened.steps?.[0]?.subject}
              </div>
              {preview.isLoading ? (
                <Skeleton className="h-[30rem]" />
              ) : (
                <iframe
                  title="Draft preview"
                  sandbox=""
                  srcDoc={preview.data?.html ?? ""}
                  className="h-[30rem] w-full rounded-md border border-border bg-white"
                />
              )}
            </>
          ) : (
            <div className="grid h-[30rem] place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              Pick a row to see the email
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StepReview;
