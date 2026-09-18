/**
 * Path → seeded response, for demo builds.
 *
 * The routing table for ./outreach-data, consulted from the one gate in
 * fetchers/leadgen/client.ts. Split out so the dataset stays a dataset and
 * this file stays a lookup — and so the list of what a demo build actually
 * fakes is readable in one screen.
 *
 * ANYTHING NOT LISTED FALLS THROUGH to the real API. That is deliberate and it
 * is the safer default: a demo build against a live cockpit shows real data on
 * every screen except the outreach ones seeded here, rather than a mixture of
 * invented data and silent blanks. If a screen looks empty in a demo build, it
 * is empty because the API said so.
 */
import {
  demoBounced,
  demoEmailStats,
  demoEngagement,
  demoRecent,
  demoStep,
} from "./outreach-data";

type Query = Record<string, string | number | undefined | null> | undefined;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The canned body for `path`, or undefined to let the request go to the API.
 *
 * `path` is the cockpit-relative path the client was called with, e.g.
 * "/api/emails/stats" — not the proxied URL.
 */
export function demoResponse<T>(path: string, query: Query): T | undefined {
  // Strip any query string the caller baked into the path itself; some call
  // sites pass "/api/emails/attention?limit=10" rather than using `query`.
  const [bare, inlineQuery] = path.split("?");
  const params = new URLSearchParams(inlineQuery ?? "");
  const get = (key: string): string | undefined =>
    (query?.[key] as string | undefined) ?? params.get(key) ?? undefined;

  switch (bare) {
    /* Home: the send-volume and engagement tiles, and the angle breakdown. */
    case "/api/emails/stats":
      return demoEmailStats(num(get("days"), 7)) as T;

    /* Home: who opened / bounced. Clicked returns an empty list by design. */
    case "/api/emails/engagement":
      return demoEngagement(String(get("kind") ?? "opened")) as T;

    /* Communications: the Sent log, paginated. */
    case "/api/emails/recent":
      return demoRecent(num(get("offset"), 0), num(get("limit"), 100)) as T;

    /* Communications: the bounce tab. */
    case "/api/emails/bounced":
      return demoBounced() as T;

    default:
      /* The reader dialog for one sent email: /api/emails/step/<id>. */
      if (bare.startsWith("/api/emails/step/")) {
        return demoStep(num(bare.slice("/api/emails/step/".length), 0)) as T;
      }
      return undefined;
  }
}
