/**
 * The client's past hires on Upwork.
 *
 * Ported from the legacy drawer (LeadDrawer.tsx PastHiresSection). Parsed from
 * sourcePayload.client_job_history_full, which the scraper lifts out of
 * Upwork's __NUXT_DATA__ visitor payload.
 *
 * The freelancer feedback is the reason this section exists: freelancers
 * routinely address the buyer by first name ("Working with Sarah was great"),
 * and that name appears nowhere else — Upwork hides client names on listings.
 * It is the highest-value personalisation signal on the whole lead.
 *
 * Collapsed by default so a 50-hire client doesn't swallow the panel, open
 * automatically when there are only a few.
 */

type PastHire = {
  title?: string;
  job_url?: string;
  client_rating?: string | number;
  client_feedback?: string;
  total_billed?: string;
  hourly_rate?: string;
  hours?: string | number;
  freelancer_name?: string;
  start_date?: string;
  status?: string;
  ciphertext?: string;
};

function parsePastHires(sourcePayload: unknown): PastHire[] {
  if (!sourcePayload || typeof sourcePayload !== "object") return [];
  const raw = (sourcePayload as Record<string, unknown>).client_job_history_full;
  if (!raw) return [];
  // The scraper writes a JSON-stringified array; the DB roundtrips it as the
  // same string inside the jsonb payload. Be defensive in case a future ingest
  // path stops the json.dumps step and stores the array directly.
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? (parsed as PastHire[]) : [];
}

export function PastHiresSection({ sourcePayload }: { sourcePayload: unknown }) {
  const hires = parsePastHires(sourcePayload);
  if (hires.length === 0) return null;

  // Aggregate signals in the header — reviewers want the numbers at a glance
  // without expanding 50 items.
  const total = hires.length;
  const ratedHires = hires.filter((h) => h.client_rating);
  const avg =
    ratedHires.length > 0
      ? (
          ratedHires.reduce((s, h) => s + Number(h.client_rating || 0), 0) /
          ratedHires.length
        ).toFixed(2)
      : null;
  const summary = avg ? `${total} past · avg ★ ${avg}` : `${total} past`;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <details className="rounded-md border border-border p-3" open={total <= 3}>
        <summary className="cursor-pointer select-none text-xs font-medium">
          <span className="uppercase tracking-wide text-muted-foreground">
            Past hires
          </span>
          <span className="ml-2">{summary}</span>
        </summary>
        <ul className="mt-3 space-y-3">
          {hires.slice(0, 25).map((h, i) => (
            <li
              key={`${h.ciphertext ?? i}`}
              className="border-l-2 border-muted pl-3"
            >
              <div className="text-sm font-medium">
                {h.job_url ? (
                  <a
                    href={h.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {h.title || "(untitled)"}
                  </a>
                ) : (
                  h.title || "(untitled)"
                )}
              </div>
              {/* Compact metadata row — only fields that have values, so empty
                  $0 fixed-price gigs don't clutter the line. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {h.client_rating ? <span>★ {h.client_rating}</span> : null}
                {h.total_billed ? <span>{h.total_billed}</span> : null}
                {h.hourly_rate ? <span>{h.hourly_rate}</span> : null}
                {h.hours ? <span>{h.hours}h</span> : null}
                {h.freelancer_name ? (
                  <span>· hired {h.freelancer_name}</span>
                ) : null}
                {h.start_date ? (
                  <span>· {String(h.start_date).slice(0, 10)}</span>
                ) : null}
                {h.status ? <span>· {h.status}</span> : null}
              </div>
              {/* The freelancer's feedback ABOUT the buyer. Italicised so it
                  reads as a quote. */}
              {h.client_feedback ? (
                <blockquote className="mt-1 border-l-2 border-emerald-500/40 bg-emerald-500/5 py-1 pl-2 text-xs italic">
                  {h.client_feedback}
                </blockquote>
              ) : null}
            </li>
          ))}
        </ul>
        {hires.length > 25 ? (
          <div className="mt-2 text-xs text-muted-foreground">
            … {hires.length - 25} more in raw payload
          </div>
        ) : null}
      </details>
    </div>
  );
}

export default PastHiresSection;
