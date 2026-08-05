// Serper.dev — Google SERP API for the cheap discovery step of the lead
// enrichment waterfall. Used to find:
//   - LinkedIn profile URL (site:linkedin.com/in "{company}" "{title}")
//   - Company website / domain ("{company}" official site)
//
// Pricing: $0.001/query at PAYG. We aim for 2 queries per lead (~$0.002).
//
// Two endpoints:
//   POST https://google.serper.dev/search   — SERP JSON
//   POST https://scrape.serper.dev/         — fetch + extract one URL (we
//     don't use this in the waterfall; SERP snippets are enough).
//
// Key is the SERPER_API_KEY env var (passed as X-API-KEY header).
//
// Returns null on missing key / non-2xx after retries — callers treat null
// as "no data" and fall through. The waterfall MUST NOT throw, since one
// flaky upstream shouldn't poison the whole pipeline.

const ENDPOINT = "https://google.serper.dev/search";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

export interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  date?: string;
}

export interface SerperResponse {
  organic?: SerperOrganicResult[];
  knowledgeGraph?: { title?: string; website?: string; descriptionLink?: string };
  searchParameters?: { q?: string; gl?: string; hl?: string };
}

async function callSerper(
  query: string,
  apiKey: string,
  opts: { gl?: string; num?: number } = {},
): Promise<SerperResponse | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          gl: opts.gl ?? "us",
          num: opts.num ?? 5,
        }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
      }
      if (!res.ok) {
        console.warn(`[serper] HTTP ${res.status} for query "${query}"`);
        return null;
      }
      return (await res.json()) as SerperResponse;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  console.warn(`[serper] all retries failed for "${query}":`, lastErr);
  return null;
}

export async function searchSerper(
  query: string,
  opts: { gl?: string; num?: number } = {},
): Promise<SerperResponse | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[serper] SERPER_API_KEY missing — discovery step disabled");
    return null;
  }
  return callSerper(query, apiKey, opts);
}

// Discover a person's LinkedIn /in/ profile URL given company + (optional)
// title and (optional) name. We constrain the SERP to linkedin.com/in via
// site: filter — Google still returns the result even though linkedin
// actively cloaks the page itself.
//
// Returns the first /in/ URL it sees in `organic`, or null.
export async function searchLinkedInProfile(args: {
  company: string;
  jobTitle?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  country?: string | null;
}): Promise<{ url: string; titleSnippet: string | null } | null> {
  const parts: string[] = [];
  parts.push("site:linkedin.com/in");
  if (args.firstName && args.lastName) {
    parts.push(`"${args.firstName} ${args.lastName}"`);
  }
  parts.push(`"${args.company}"`);
  if (args.jobTitle && !args.firstName) {
    // Title only helps when we don't have a name — otherwise it narrows too
    // hard against people who've moved roles.
    parts.push(`"${args.jobTitle}"`);
  }
  const q = parts.join(" ");
  const gl = countryToGl(args.country);
  const res = await searchSerper(q, { gl: gl ?? undefined, num: 5 });
  if (!res?.organic) return null;
  for (const r of res.organic) {
    const link = r.link ?? "";
    if (/linkedin\.com\/in\//i.test(link)) {
      return { url: link, titleSnippet: r.title ?? null };
    }
  }
  return null;
}

// Discover a company's primary domain. We pull from the knowledge graph
// when available (most accurate), otherwise fall back to the first organic
// result that isn't social media or a directory.
//
// Returns the bare domain (no protocol, no www). Null if nothing usable.
export async function searchCompanyDomain(
  company: string,
): Promise<string | null> {
  const q = `"${company}" official site`;
  const res = await searchSerper(q, { num: 5 });
  if (!res) return null;
  const candidate =
    res.knowledgeGraph?.website ??
    res.organic?.find((r) => {
      const link = r.link ?? "";
      if (!link) return false;
      return !/(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|crunchbase\.com|bloomberg\.com|wikipedia\.org)/i.test(
        link,
      );
    })?.link ?? null;
  if (!candidate) return null;
  return normalizeDomain(candidate);
}

// "United States" → "us", "United Kingdom" → "uk", etc. Keep the list short
// and let unknown countries fall through to default ("us") at the call site.
// SERP results are sensitive to gl — passing the wrong country can pull up
// regional spam and miss the actual company website.
function countryToGl(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toLowerCase();
  const map: Record<string, string> = {
    "united states": "us",
    usa: "us",
    "united kingdom": "uk",
    uk: "uk",
    england: "uk",
    canada: "ca",
    australia: "au",
    germany: "de",
    france: "fr",
    netherlands: "nl",
    spain: "es",
    italy: "it",
    india: "in",
    singapore: "sg",
    "united arab emirates": "ae",
    uae: "ae",
    "saudi arabia": "sa",
  };
  return map[c] ?? null;
}

export function normalizeDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
