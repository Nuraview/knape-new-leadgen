/**
 * The client's own 0–10 verdict on a lead, next to the model's ICP score.
 *
 * The two are deliberately separate: ICP is what the scoring model inferred
 * from the research, this is what the person who knows the business says. The
 * leads list can sort on either.
 *
 * Ratings are stored against the COMPANY, not this page's account id, because a
 * scrape rebuilds the accounts table and reassigns ids — see the cockpit's
 * outreach/lead_feedback.py.
 *
 * Ported from the cockpit's own LeadRatingCard, wording unchanged. The copy is
 * the feature: it is what tells the reader this number is theirs and not the
 * model's, and where the payoff for setting it shows up.
 */
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { leadgen } from "@/fetchers/leadgen/client";
import { cn } from "@/lib/cn";

type LeadRatingCardProps = {
  accountId: number | string;
  company: string;
  /** Rating already stored for this lead, or null when nobody has rated it. */
  initialRating: number | null;
  /** Lets the list behind the detail page pick up the new rating. */
  onRated?: (rating: number | null) => void;
};

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Colour band for the client's own 0–10 rating (not the ICP score). */
export function ratingTone(rating: number): "good" | "mid" | "poor" {
  if (rating >= 8) return "good";
  if (rating >= 5) return "mid";
  return "poor";
}

const TONE_CLASS: Record<ReturnType<typeof ratingTone>, string> = {
  good: "border-emerald-500 bg-emerald-500 text-white",
  mid: "border-amber-500 bg-amber-500 text-white",
  poor: "border-red-500 bg-red-500 text-white",
};

/** Badge colours for a rating shown on a list row. */
export const RATING_BADGE_CLASS: Record<
  ReturnType<typeof ratingTone>,
  string
> = {
  good: "bg-emerald-500/15 text-emerald-500",
  mid: "bg-amber-500/15 text-amber-500",
  poor: "bg-red-500/15 text-red-500",
};

function verdict(rating: number | null): string {
  if (rating === null) return "Not rated yet";
  if (rating >= 8) return "Strong lead — worth pursuing now";
  if (rating >= 5) return "Worth keeping";
  if (rating >= 1) return "Weak fit";
  return "Not a fit at all";
}

export function LeadRatingCard({
  accountId,
  company,
  initialRating,
  onRated,
}: LeadRatingCardProps) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRating(initialRating);
    setSaved(false);
    setError("");
  }, [initialRating, accountId]);

  async function save(next: number | null) {
    const previous = rating;
    setRating(next); // optimistic: the click should feel instant
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const r = await leadgen.put<{ rating: number | null }>(
        `/api/leads/${accountId}/rating`,
        { rating: next },
      );
      setRating(r.rating ?? null);
      setSaved(true);
      onRated?.(r.rating ?? null);
    } catch (e) {
      setRating(previous); // put the old value back rather than lying about it
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-labelledby="lead-rating-heading"
    >
      <h2
        id="lead-rating-heading"
        className="flex flex-wrap items-center gap-2 text-sm font-semibold"
      >
        <Star className="size-4 text-amber-500" aria-hidden="true" />
        Your rating
        <span className="font-normal text-xs text-muted-foreground">
          How good is this lead, 0–10?
        </span>
      </h2>

      <p className="mt-2 text-sm text-muted-foreground">
        Your own score for {company || "this company"}, kept separate from the
        ICP score the model works out. Sort the leads list by{" "}
        <strong className="font-medium text-foreground">Your rating</strong> to
        bring the best ones to the top.
      </p>

      <div
        className="mt-3 flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={`Rate ${company || "this lead"} from 0 to 10`}
      >
        {SCALE.map((n) => {
          const active = rating === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              className={cn(
                "size-9 rounded-md border text-sm tabular-nums transition-colors disabled:opacity-60",
                active
                  ? `font-semibold ${TONE_CLASS[ratingTone(n)]}`
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
              disabled={saving}
              onClick={() => void save(n)}
              title={`Rate ${n} out of 10`}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "text-sm",
            rating === null ? "text-muted-foreground" : "font-medium",
          )}
        >
          {verdict(rating)}
        </span>
        {rating !== null ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-60"
            onClick={() => void save(null)}
            disabled={saving}
          >
            Clear rating
          </button>
        ) : null}
      </div>

      {saving ? (
        <p className="mt-2 text-xs text-muted-foreground">Saving…</p>
      ) : null}
      {saved && !saving ? (
        <p className="mt-2 text-xs text-emerald-500">Saved.</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
    </section>
  );
}
