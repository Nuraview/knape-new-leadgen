/**
 * Step 1 — how many, and out of what.
 *
 * The funnel is the cockpit's own, restored in plain English. Three terse stat
 * cards told you "Pool remaining 236" and left you to work out why it was not
 * 1,333; this says it in a sentence you can read to a client.
 */
import type { CampaignStatus } from "@/fetchers/leadgen/emails";
import type { CampaignDraft } from "./types";

function Arrow() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      →
    </span>
  );
}

export function StepAudience({
  status,
  draft,
  onChange,
}: {
  status?: CampaignStatus;
  draft: CampaignDraft;
  onChange: (patch: Partial<CampaignDraft>) => void;
}) {
  const funnel = status?.funnel;
  const pool = status?.pool_remaining ?? null;
  const cap = status?.cap_remaining ?? null;
  // Drafting is not capped — only sending is. But offering to draft ten times
  // what can go out this week is a way to build a queue nobody clears.
  const suggested = Math.min(pool ?? 0, 200);
  // Drafting more than exists is not a smaller run, it is a wrong number on
  // screen. Cap the control at the pool.
  const ceiling = Math.max(1, pool ?? 2000);
  const empty = pool === 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Who are we writing to?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Leads that have a contact address and have never been written to.
          Addresses are checked before anything is drafted, so dead ones never
          reach the queue.
        </p>
      </div>

      {funnel ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <span>
            <strong className="tabular-nums">
              {funnel.total.toLocaleString()}
            </strong>{" "}
            leads found
          </span>
          <Arrow />
          <span>
            <strong className="tabular-nums">
              {funnel.with_email.toLocaleString()}
            </strong>{" "}
            have a contact email
          </span>
          <Arrow />
          <span className="text-muted-foreground">
            <strong className="tabular-nums">
              {funnel.emailed.toLocaleString()}
            </strong>{" "}
            already emailed
          </span>
          <Arrow />
          <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-600">
            <strong className="tabular-nums">{pool ?? "…"}</strong> fresh &
            ready
          </span>
        </div>
      ) : null}

      {funnel && funnel.no_email > 0 ? (
        <p className="text-xs text-muted-foreground">
          {funnel.no_email.toLocaleString()} more leads have no contact address
          yet. Contact-finding (Pipeline settings → Enrichment) unlocks them into
          this pool over time — that, not the send cap, is what limits volume.
        </p>
      ) : null}

      <label className="block max-w-xs">
        <span className="text-xs font-medium text-muted-foreground">
          How many to draft
        </span>
        <input
          type="number"
          min={1}
          max={ceiling}
          value={draft.total}
          /*
           * Clamped on the way in, not merely validated.
           *
           * `max` on a number input only marks the field invalid — it does not
           * stop typing — so the box happily accepted 50000 against a pool of
           * zero. A campaign size that cannot exist should not be expressible.
           */
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange({ total: Math.max(1, Math.min(ceiling, Math.floor(n))) });
          }}
          disabled={empty}
          className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums disabled:opacity-50"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          {pool !== null ? `${pool} available` : "…"}
          {cap !== null ? ` · ${cap} can be sent in the next 24h` : ""}
        </span>
      </label>

      {empty ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600">
          <strong>Nothing to draft.</strong> Every lead with a named contact has
          already been written to. New ones arrive from contact-finding — see
          Pipeline settings → Enrichment. Volume is limited by addresses, not by
          the send cap.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[25, 50, 100, suggested]
          .filter((n, i, a) => n > 0 && a.indexOf(n) === i && n <= ceiling)
          .map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ total: n })}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                draft.total === n
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted"
              }`}
            >
              {n}
            </button>
          ))}
        {!empty && ceiling < 25 ? (
          <button
            type="button"
            onClick={() => onChange({ total: ceiling })}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
          >
            all {ceiling}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default StepAudience;
