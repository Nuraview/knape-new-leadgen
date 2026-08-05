// ContactOut — LinkedIn-native unified enricher. ONE API call returns
// work_email + personal_email + phone (+ rich profile). When we already
// have a LinkedIn URL from Serper discovery, this is the highest-value
// step in the waterfall — it can fill both email AND phone without
// touching Prospeo/Findymail/MillionVerifier/Prospeo-mobile, and when
// work_email_status="Verified" we can skip the MillionVerifier step
// entirely for that email.
//
// Docs: https://api.contactout.com
//   POST /v1/people/enrich
//   Header: `token: <CONTACTOUT_API_KEY>`
//   Body MUST include `include: ["work_email","personal_email","phone"]`
//     — by default contact fields are omitted from the response.
//   Match requires either a primary identifier (linkedin_url / email /
//   phone) OR name + secondary (company / company_domain / location /
//   education). 404 = no match.
//
// Returns null on missing key / no match / non-2xx after retries —
// matching the graceful-null contract of the other enrichment providers.

const ENDPOINT = "https://api.contactout.com/v1/people/enrich";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export interface ContactOutResult {
  workEmail: string | null;
  personalEmail: string | null;
  // True only when ContactOut explicitly reports `work_email_status:
  // "Verified"`. Unverified / guessed emails still go through the
  // MillionVerifier deliverability gate before being persisted.
  emailVerified: boolean;
  phone: string | null;
  fullName: string | null;
  headline: string | null;
  raw: unknown;
}

function pickStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pickFirstStr(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  for (const v of arr) {
    const s = pickStr(v);
    if (s) return s;
  }
  return null;
}

export async function enrichViaContactOut(args: {
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  domain?: string | null;
}): Promise<ContactOutResult | null> {
  const token = process.env.CONTACTOUT_API_KEY;
  if (!token) {
    console.warn("[contactout] CONTACTOUT_API_KEY missing — layer disabled");
    return null;
  }

  // ContactOut requires either a primary identifier or name + at least
  // one secondary parameter (company/domain).
  const hasUrl = !!args.linkedinUrl;
  const hasName = !!(args.firstName && args.lastName);
  const hasSecondary = !!(args.company || args.domain);
  if (!hasUrl && !(hasName && hasSecondary)) return null;

  const body: Record<string, unknown> = {
    include: ["work_email", "personal_email", "phone"],
  };
  if (args.linkedinUrl) body.linkedin_url = args.linkedinUrl;
  if (args.firstName) body.first_name = args.firstName;
  if (args.lastName) body.last_name = args.lastName;
  if (args.firstName && args.lastName) {
    body.full_name = `${args.firstName} ${args.lastName}`;
  }
  if (args.company) body.company = [args.company];
  if (args.domain) body.company_domain = [args.domain];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      // 404 = empty results per docs; clean null.
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
          continue;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[contactout] HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }

      const json = (await res.json().catch(() => null)) as {
        status_code?: number;
        profile?: Record<string, unknown>;
      } | null;
      const profile = json?.profile;
      if (!profile) return null;

      const workEmail = pickFirstStr(profile.work_email);
      const personalEmail = pickFirstStr(profile.personal_email);
      const phone = pickFirstStr(profile.phone);

      // work_email_status may be a string ("Verified"/"Unverified") OR an
      // array (one status per work_email). Treat as verified only on an
      // explicit "Verified" match — never default to true.
      const status = profile.work_email_status;
      const verified =
        typeof status === "string"
          ? status.toLowerCase() === "verified"
          : Array.isArray(status)
            ? status.some(
                (s) =>
                  typeof s === "string" && s.toLowerCase() === "verified",
              )
            : false;

      return {
        workEmail,
        personalEmail,
        emailVerified: !!workEmail && verified,
        phone,
        fullName: pickStr(profile.full_name),
        headline: pickStr(profile.headline),
        raw: profile,
      };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
        );
        continue;
      }
      console.warn(`[contactout] all retries failed:`, err);
      return null;
    }
  }
  return null;
}

// ContactOut Email → LinkedIn API:
//   GET /v1/people/person?email=<email>
//   { status_code: 200, profile: { email, linkedin } } | 404
// Useful as a tail step: when we found an email (via any layer) but
// Serper didn't surface a LinkedIn URL, backfill the linkedin field
// from the email. Consumes 1 email credit on hit per the docs.
export interface ContactOutEmailLookup {
  linkedinUrl: string;
  raw: unknown;
}

export async function findLinkedInByEmailViaContactOut(
  email: string,
): Promise<ContactOutEmailLookup | null> {
  const token = process.env.CONTACTOUT_API_KEY;
  if (!token) return null;
  if (!email || !email.includes("@")) return null;

  const url =
    "https://api.contactout.com/v1/people/person?email=" +
    encodeURIComponent(email);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", token },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
          continue;
        }
      }
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as {
        status_code?: number;
        profile?: { email?: string; linkedin?: string };
      } | null;
      const li = json?.profile?.linkedin;
      if (typeof li === "string" && li.startsWith("http")) {
        return { linkedinUrl: li, raw: json?.profile };
      }
      return null;
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
        );
        continue;
      }
      return null;
    }
  }
  return null;
}

// ContactOut People Search API:
//   POST /v1/people/search
//   { company: [name], company_domain: [domain]?, job_title: [titles],
//     reveal_info: true, page: 1 }
//
// Use case: an Upwork lead arrives with company + job description but
// NO person name (e.g., "Kunath Group" hiring a German Social Media
// Manager — the buyer's identity isn't in the posting). Without a name
// the rest of the waterfall is paralysed. Search the company for likely
// decision-makers (Founder / CEO / Owner — the most common buyer
// persona for SMB Upwork postings) and return the top hit with name +
// LinkedIn + (with reveal_info=true) work_email + phone.
//
// Cost per docs: 1 search credit per profile + 1 email + 1 phone credit
// per profile when reveal_info=true. We cap the page size to keep this
// bounded.

const SEARCH_ENDPOINT = "https://api.contactout.com/v1/people/search";

// SMB Upwork buyers — the person who posted the job — almost always
// sits at the top of the org chart. Order matters: ContactOut returns
// the first match per the search ranking; founders/owners are usually
// also the hiring contact.
const DEFAULT_DECISION_MAKER_TITLES = [
  "Founder",
  "Co-Founder",
  "CEO",
  "Owner",
  "Managing Director",
];

export interface ContactOutSearchResult {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  raw: unknown;
}

export async function searchDecisionMakerViaContactOut(args: {
  company?: string | null;
  domain?: string | null;
  titles?: string[];
}): Promise<ContactOutSearchResult | null> {
  const token = process.env.CONTACTOUT_API_KEY;
  if (!token) {
    console.warn(
      "[contactout] CONTACTOUT_API_KEY missing — decision-maker search disabled",
    );
    return null;
  }
  if (!args.company && !args.domain) return null;

  const body: Record<string, unknown> = {
    job_title:
      args.titles && args.titles.length
        ? args.titles
        : DEFAULT_DECISION_MAKER_TITLES,
    reveal_info: true,
    page: 1,
  };
  if (args.company) body.company = [args.company];
  if (args.domain) body.company_domain = [args.domain];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
          continue;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[contactout/search] HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }

      const json = (await res.json().catch(() => null)) as {
        profiles?: Array<Record<string, unknown>>;
        results?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
      } | null;
      // ContactOut's search response wrapper varies by plan; probe
      // `profiles` first, fall back to `results` / `data`.
      const list =
        (Array.isArray(json?.profiles) && json!.profiles) ||
        (Array.isArray(json?.results) && json!.results) ||
        (Array.isArray(json?.data) && json!.data) ||
        [];
      if (!list.length) return null;
      const first = list[0];

      const contact =
        (first.contact_info as Record<string, unknown> | undefined) ?? {};
      const workEmail =
        pickFirstStr(contact.work_emails) ?? pickFirstStr(contact.emails);
      const personalEmail = pickFirstStr(contact.personal_emails);
      const phone = pickFirstStr(contact.phones);
      const fullName = pickStr(first.full_name) ?? pickStr(first.name);
      const linkedinUrl =
        pickStr(first.linkedin_url) ??
        pickStr(first.linkedin) ??
        pickStr(first.url);

      let firstName: string | null = pickStr(first.first_name);
      let lastName: string | null = pickStr(first.last_name);
      if ((!firstName || !lastName) && fullName) {
        const parts = fullName.split(/\s+/);
        if (parts.length >= 2) {
          firstName = firstName ?? parts[0];
          lastName = lastName ?? parts.slice(1).join(" ");
        }
      }

      return {
        fullName,
        firstName,
        lastName,
        title:
          pickStr(first.title) ??
          pickStr(first.headline) ??
          pickStr(first.job_title),
        linkedinUrl,
        workEmail,
        personalEmail,
        phone,
        raw: first,
      };
    } catch {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
        );
        continue;
      }
      return null;
    }
  }
  return null;
}
