// Pull a contact email out of scraped free text — the Upwork posting body.
//
// Why this exists: the scraper never sends an email. `apps/scraper/pusher.py`
// posts `"email": null` with every lead ("n8n workflow never extracts email")
// because Upwork does not expose the client's address on the job page. The CRM's
// `email` column could then only be filled by the paid enrichment waterfall, and
// when that waterfall finds nothing the lead stays email-less.
//
// Posters, however, routinely write an address into the posting itself ("send
// your portfolio to hello@acme.com"), and it is already in our database inside
// `crm_Leads.description` / `source_payload.job_description`. This reads it.
//
// HOW IT WORKS — normalise once, then scan:
//
//   decodeEntities()     &#64; &#x40; &commat; &#46; &period; &nbsp; zero-width junk
//   decodeUrlAt()        %40 (mailto hrefs and query strings)
//   flattenWhitespace()  \r\n, tabs, non-breaking spaces
//   unwrapLineBreaks()   "john@\nacme.com" — column/chat wrapping
//   expandBracketed()    john[at]acme[dot]com · john(at)acme(dot)com · john(@)acme(.)com
//   expandAtWordDot()    john@acme dot com      (real @, obfuscated dot)
//   expandBareWords()    john at acme dot com   (cue-guarded, see below)
//   → CANDIDATE_RE scan → tidy → isUsableContactEmail → dedupe → cap → rank
//
// Two rules stop this from inventing addresses nobody wrote:
//
//   1. An address that is NOT literally present in the raw text — i.e. we
//      reconstructed it — must end in a TLD from COMMON_TLDS. That is what keeps
//      `meet at 3 dot 5 pm` from becoming `meet@3.pm` and `the list [at]
//      a.glance` from becoming `list@a.glance`.
//   2. Bare-word obfuscation ("john at acme dot com") is rewritten only on a line
//      that also carries a contact cue (email / contact / resume / …) and never
//      from an English word as the local part, so "email us at acme dot com"
//      cannot become `us@acme.com`.
//
// Filtering is unchanged in spirit and stricter in coverage: placeholders,
// bounce/system mailboxes, the platform's own domains and asset filenames
// (`logo@2x.png`) are dropped. A wrong address in the primary slot is worse than
// a blank one — reviewers send from that field.
//
// Extracted addresses are NOT verified, by design: they are addresses the poster
// wrote. Verification and the write gate stay exactly where they were, in the
// enrichment waterfall.
//
// Dependency-free on purpose, so it can be unit-tested without a database.

/** Local-part@domain.tld, permissive enough to survive wrapping punctuation. */
const CANDIDATE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Nothing longer than this survives a real mailbox, and junk is often huge. */
const MAX_LOCAL_LENGTH = 40;
const MAX_DOMAIN_LENGTH = 253;
/** A posting with more addresses than this is a list, not a contact. */
const MAX_CANDIDATES = 8;

/**
 * Domains that are never the buyer: placeholders, the platform's own mailboxes,
 * social/aggregator hosts that arrive inside quoted footers, and asset/CDN hosts
 * that leak out of scraped markup. Subdomains count too — see domainIsBlocked().
 */
const BAD_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "example.io",
  "domain.com",
  "company.com",
  "email.com",
  "test.com",
  "mail.com",
  "yourdomain.com",
  "yourcompany.com",
  // Upwork's own mail, which appears in postings and in our own templates.
  "upwork.com",
  "upworkmail.com",
  // Asset/CDN hosts that leak out of scraped markup.
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "gstatic.com",
  "googleapis.com",
  "google.com",
  // Social/aggregator platforms: an address at these is a platform mailbox or a
  // footer artefact, never the buyer.
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
];

/**
 * Local parts that are plumbing, not a person or a shared inbox we should use.
 * The first block is RFC 2142 / bounce machinery; the second is the noise that
 * arrives with quoted email footers inside a posting.
 */
const BAD_LOCALS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "abuse",
  "privacy",
  "legal",
  "unsubscribe",
  "bounce",
  "bounces",
  "newsletter",
  "notifications",
  "notification",
  "auto-reply",
  "autoreply",
  "webmaster",
  "hostmaster",
  "dmca",
  "spam",
]);

/**
 * File extensions and RFC-2606 reserved TLDs. An alphabetic TLD check alone is
 * not enough: scraped markup is full of `logo@2x.png`, where `.png` looks like a
 * perfectly good TLD.
 */
const BAD_DOMAIN_SUFFIXES = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
  ".css", ".js", ".mjs", ".json", ".xml", ".html", ".htm", ".map", ".txt",
  ".woff", ".woff2", ".ttf", ".eot", ".otf", ".mp4", ".webm", ".pdf",
  ".local", ".invalid", ".test", ".example", ".localhost", ".internal",
];

/** `email1@`, `name@`, `test@`, a bare number, or a machine-generated hash. */
const BAD_LOCAL_RE = [
  /^(email|name|test|example|sample|user|yourname|firstname|lastname|placeholder)\d*$/,
  /^[0-9a-f]{16,}$/,
  /^\d+$/,
];

/** Prefixes of a shared inbox — a decent lead contact when nothing better exists. */
const CONTACT_PREFIXES = [
  "info",
  "hello",
  "contact",
  "sales",
  "enquir",
  "inquir",
  "office",
  "admin",
  "team",
  "bid",
  "quote",
  "estimating",
  "purchas",
];

/**
 * TLDs trusted for a RECONSTRUCTED address — one we had to un-obfuscate.
 *
 * An address that appears verbatim in the text needs no such guard; one rebuilt
 * from "at"/"dot" words does, or `meet at 3 dot 5 pm` becomes `meet@3.pm` and a
 * false positive reaches a reviewer. Country codes that collide with English
 * words (at, it, in, us, no, be, is, do, my, so, to, me, am, pm) are therefore
 * absent; the cost is missing a `.be`/`.in` written as bare words, which is rare
 * next to the cost of a wrong address.
 */
const COMMON_TLDS = new Set([
  "com","org","net","edu","gov","mil","int","info","biz","io","co","ai","app",
  "dev","tech","xyz","online","site","store","shop","cloud","work","agency","studio",
  "eu","uk","ca","au","nz","ie","de","fr","es","pt","nl","ch","se","dk","fi","pl",
  "cz","sk","hu","ro","bg","gr","tr","ru","ua","il","ae","sa","qa","kw","za","eg",
  "ng","ke","br","mx","ar","cl","pe","jp","cn","kr","hk","tw","sg","id","ph","vn",
  "th","pk","bd","lk","in","us","me",
]);

/**
 * Words that mark a line as contact information. Bare-word obfuscation ("john at
 * acme dot com") is rewritten only on such a line: a poster does not write "we
 * work at Acme dot com", but does write "email us at …".
 *
 * Note what is NOT here: "at" and "dot" themselves, which would match the very
 * text this gate exists to judge.
 */
const CONTACT_CUE_RE =
  /\b(?:e-?mails?|e-?mailed|contact(?:s|ed|ing)?|reach|write|send|submit|appl(?:y|ies|ication|ications)|resumes?|cvs?|portfolios?|proposals?|quotes?|quotations?|enquir(?:y|ies)|inquir(?:y|ies)|get in touch|reach out)\b/i;

/**
 * Local parts that are English, not a mailbox. A pronoun, or the verb that
 * introduces a location, sits immediately before "at" — exactly where the
 * bare-word rule looks — so "email us at acme dot com" and "based at acme dot
 * com" must never become `us@…` / `based@…`.
 *
 * Shared-inbox words (info, sales, hello, contact, admin, office, team) are
 * deliberately NOT here: `info at acme dot com` is a real, wanted address.
 */
const BARE_LOCAL_STOPWORDS = new Set([
  "us","we","me","my","our","you","your","they","them","their","him","her","his",
  "it","its","this","that","these","those","everyone","someone","anyone",
  "everybody","somebody","nobody","and","or","but","please","then","now","here",
  "there","back","again","also","still","just","only","already","directly",
  "immediately","instead","online","below","above","based","located","available",
  "hosted","reachable","listed","look","looking","meet","meeting","arrive",
  "arriving","stay","staying","join","working","work","get","call","text",
]);

/** Nouns describing physical events or places that follow "at" in prose without indicating a contact mailbox. */
const PROSE_NOUN_STOPWORDS = new Set([
  "dinner", "lunch", "breakfast", "party", "event", "hotel", "restaurant",
  "stay", "room", "building", "house", "home", "office", "store", "shop",
  "site", "location", "venue", "place", "city", "town", "station", "desk",
  "table", "door", "page",
]);

export interface EmailNameHint {
  firstName?: string | null;
  lastName?: string | null;
  /**
   * Company name and/or a known domain. Used ONLY to rank candidates — the
   * buyer's own domain usually carries their name — never to filter them.
   */
  company?: string | null;
  domain?: string | null;
}

/** Drop wrapping punctuation the regex can pick up from prose: `<a@b.com>,` etc. */
function tidy(raw: string): string {
  return raw
    .replace(/^[<(\["'`{|:;,>\s]+/, "")
    .replace(/[>)\]}"'`|:;,.;!?\s]+$/, "")
    .trim();
}

function splitLocal(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/** `https://mail.acme.com:443/x` and `acme.com.` both normalise to `acme.com`. */
function normalizeHost(host: string): string {
  const [hostPart] = host
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/);
  if (!hostPart) return "";
  const [hostname] = hostPart.split(":");
  if (!hostname) return "";
  return hostname.replace(/\.+$/, "").replace(/^www\./, "");
}

/** A DNS label: 1-63 chars, alphanumeric, hyphens only in the middle. */
function validLabel(label: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

/**
 * BAD_DOMAINS match, subdomains included: `mail.upwork.com` is as blocked as
 * `upwork.com` is, and scraped text is full of both.
 */
function domainIsBlocked(domain: string): boolean {
  return BAD_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`));
}

/**
 * Does this address end in a TLD we trust for a reconstructed (un-obfuscated)
 * candidate? Only consulted for addresses that are not literally in the source
 * text — see extractEmailsFromText().
 */
function hasCommonTld(email: string): boolean {
  const parts = splitLocal(email);
  if (!parts) return false;
  const labels = parts.domain.split(".");
  const last = labels[labels.length - 1];
  return typeof last === "string" && COMMON_TLDS.has(last);
}

// ---------------------------------------------------------------------------
// Normalisation — the structural passes that run once, before the scan
// ---------------------------------------------------------------------------

/** Replace bracketed/parenthesised/curly obfuscations like [at], (at), {at}, [@], (@), {@} with '@' and similarly for dot. */
function expandBracketed(text: string): string {
  return text
    .replace(/\s*\[\s*(?:at|@)\s*\]\s*|\s*\(\s*(?:at|@)\s*\)\s*|\s*\{\s*(?:at|@)\s*\}\s*/gi, "@")
    .replace(/\s*\[\s*(?:dot|\.)\s*\]\s*|\s*\(\s*(?:dot|\.)\s*\)\s*|\s*\{\s*(?:dot|\.)\s*\}\s*/gi, ".");
}

/** Replace hybrid literal `@` + word "dot", e.g. "john@acme dot com" or "john @ acme dot co dot uk". */
function expandHybridAtWordDot(text: string): string {
  const re = /\b([A-Za-z0-9._%+-]+)\s*@\s*([A-Za-z0-9-]+(?:\s*dot\s*[A-Za-z0-9-]+)+)\b/gi;
  return text.replace(re, (_, local, domainParts) => {
    const domain = domainParts.replace(/\s*dot\s*/gi, ".");
    return `${local}@${domain}`;
  });
}

/** Replace word "dot" with '.' when it follows an '@' or a '.' (handles whitespace / newlines). */
function expandAtWordDot(text: string): string {
  return text.replace(/([@.])\s*dot\s*/gi, "$1.");
}

/**
 * Rewrite bare‑word obfuscation "john at example dot com" or "john at acme dot co dot uk" to a proper email.
 * Guarded by non-stopword local part, valid TLD, and contextual contact signals.
 */
function expandBareWords(text: string): string {
  const re = /\b([A-Za-z0-9._%+-]+)\s+at\s+([A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z0-9-]+)+)\b/gi;
  return replaceWithGroups(text, re, (match, groups, offset, source) => {
    const local = groups[0] ?? "";
    const domainParts = groups[1] ?? "";
    const localLower = local.toLowerCase();
    if (BARE_LOCAL_STOPWORDS.has(localLower)) {
      return match;
    }
    const lineStart = source.lastIndexOf("\n", offset);
    const lineEnd = source.indexOf("\n", offset + match.length);
    const line = source.slice(
      lineStart === -1 ? 0 : lineStart + 1,
      lineEnd === -1 ? source.length : lineEnd,
    );
    const hasCueInLine = CONTACT_CUE_RE.test(line);

    const matchIndexInLine = offset - (lineStart === -1 ? 0 : lineStart + 1);
    const textBefore = line.slice(0, matchIndexInLine).trim();

    const hasLabelPrefix = /(?:e-?mail|contact|reach|write|send|to|at)[:\s]*$/i.test(textBefore);
    const isMultiWordName = /[a-z0-9._%+-]+\s+$/i.test(textBefore);
    const hasLocativeProseBefore = /\b(?:a|an|the|our|your|my|his|her|their|its|this|that|have|had|join|attend|visit|at|in|from)\s+$/i.test(textBefore);
    const isAmbiguousProseNoun = PROSE_NOUN_STOPWORDS.has(localLower) || /^(?:dinner|meeting|office|lunch|breakfast|party|event|hotel|restaurant|stay|room|building|house|home|store|shop|site|location|venue|place|city|town|station|desk|table|door|page)$/i.test(localLower);

    const isValidBareWordContext =
      hasCueInLine ||
      hasLabelPrefix ||
      (isMultiWordName && !hasLocativeProseBefore) ||
      (!isAmbiguousProseNoun && !hasLocativeProseBefore);

    if (!isValidBareWordContext) {
      return match;
    }

    const domain = domainParts.replace(/\s+dot\s+/gi, ".");
    const reconstructed = `${local}@${domain}`;
    if (!hasCommonTld(reconstructed)) {
      return match;
    }
    return reconstructed;
  });
}



/**
 * `String.replace` with numbered groups, typed. The variadic callback shape is
 * awkward under strict settings, and the passes below all need the match offset
 * (to find the line) as well as the groups.
 */
function replaceWithGroups(
  text: string,
  re: RegExp,
  fn: (match: string, groups: string[], offset: number, source: string) => string,
): string {
  return text.replace(re, (...args: unknown[]) => {
    const match = String(args[0] ?? "");
    const source = String(args[args.length - 1] ?? "");
    const offset = Number(args[args.length - 2] ?? 0);
    const groups = args
      .slice(1, args.length - 2)
      .map((g) => (g == null ? "" : String(g)));
    return fn(match, groups, offset, source);
  });
}

/** Zero-width characters that trackers and copy/paste leave in scraped text. */
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF\u2060]/g;

/** `&#64;` `&#x40;` `&#46;` `&commat;` `&period;` `&nbsp;` — and nothing else. */
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  commat: "@",
  period: ".",
  nbsp: " ",
};

/**
 * Decode only the characters that can sit inside an address. Decoding the whole
 * entity set (`&amp;`, `&quot;`, …) would rewrite prose we have no business
 * touching; `&#64;` is the one an obfuscated address is built from.
 */
function decodeEntities(text: string): string {
  return replaceWithGroups(text, ENTITY_RE, (whole, groups) => {
    const body = groups[0] ?? "";
    if (!body.startsWith("#")) {
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    }
    const hex = body.charAt(1) === "x" || body.charAt(1) === "X";
    const code = Number.parseInt(
      hex ? body.slice(2) : body.slice(1),
      hex ? 16 : 10,
    );
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
    const ch = String.fromCodePoint(code);
    // @ and . can form an address; 160 is a non-breaking space; 8203 is the
    // zero-width space. Anything else is left exactly as written.
    return ch === "@" || ch === "." || code === 160 || code === 8203
      ? ch
      : whole;
  });
}

/**
 * `%40` is a URL-encoded at-sign — mailto hrefs and `?email=` query strings are
 * full of them. It is the only percent-escape decoded: `@` has no other meaning
 * in text, so this cannot invent an address, whereas decoding `%2E` could.
 */
function decodeUrlAt(text: string): string {
  return text.replace(/%40/gi, "@");
}

/** Line endings, tabs and the non-breaking-space family → plain space/newline. */
function flattenWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\t/g, " ");
}

/**
 * Column- or chat-wrapped addresses: "…write to john@\nacme.com". The break has
 * to follow an `@` (or a dot already inside a domain) and be followed by more
 * domain — that anchor is what makes joining the lines safe.
 */
const WRAPPED_AT_BREAK_RE =
  /([A-Za-z0-9._%+-]{1,64})@[ \t]*\n[ \t]*([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const WRAPPED_DOT_BREAK_RE =
  /([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63})\.[ \t]*\n[ \t]*([A-Za-z]{2,24})\b/g;

function unwrapLineBreaks(text: string): string {
  return text
    .replace(WRAPPED_AT_BREAK_RE, "$1@$2")
    .replace(WRAPPED_DOT_BREAK_RE, "$1.$2");
}

/**
 * Is this a plausible buyer address? Conservative by design — see the file
 * header. Exported so callers can validate an address they already hold.
 */
export function isUsableContactEmail(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const email = tidy(raw).toLowerCase();
  const parts = splitLocal(email);
  if (!parts) return false;

  const { local, domain } = parts;
  if (local.length > MAX_LOCAL_LENGTH || domain.length > MAX_DOMAIN_LENGTH) {
    return false;
  }
  if (email.includes("..")) return false;
  if (!/^[a-z0-9.-]+$/.test(domain)) return false;
  // The TLD has to be alphabetic — this is what rejects `logo@2x.png`,
  // `sprite@3x.png` and every other "@<scale>x.<ext>" asset artefact.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,}$/.test(tld)) return false;
  if (BAD_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return false;
  if (domainIsBlocked(domain)) return false;
  if (BAD_LOCALS.has(local)) return false;
  if (BAD_LOCAL_RE.some((re) => re.test(local))) return false;
  return true;
}

/**
 * Score a candidate. Higher is better; 0 means "usable but unremarkable".
 *
 * A local part built from the client's own name outranks a shared inbox, which
 * outranks a random address found in the body copy (a video link, a supplier,
 * a partner brand).
 */
function score(email: string, hint: EmailNameHint): number {
  const parts = splitLocal(email);
  if (!parts) return -1;
  const { local } = parts;
  const first = (hint.firstName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const last = (hint.lastName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const flat = local.replace(/[^a-z]/g, "");

  let s = 0;
  if (last.length > 2 && (local.includes(last) || flat.includes(last))) s += 4;
  else if (last.length > 4 && flat.includes(last.slice(0, 5))) s += 3;
  if (first.length > 2 && local.includes(first)) s += 2;
  if (first && last && local.includes(`${first[0]}${last}`)) s += 3;
  if (CONTACT_PREFIXES.some((p) => local.startsWith(p))) s += 1;
  return s;
}

/**
 * Every usable address in `text`, in reading order, de-duplicated case
 * insensitively. Empty array when there is nothing worth keeping.
 */
export function extractEmailsFromText(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text) return [];

  const rawText = text;

  let normalized = text.replace(INVISIBLE_RE, "");
  normalized = decodeEntities(normalized);
  normalized = decodeUrlAt(normalized);
  normalized = flattenWhitespace(normalized);
  normalized = unwrapLineBreaks(normalized);
  normalized = expandBracketed(normalized);
  normalized = expandHybridAtWordDot(normalized);
  normalized = expandAtWordDot(normalized);
  normalized = expandBareWords(normalized);

  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of normalized.match(CANDIDATE_RE) ?? []) {
    const email = tidy(match).toLowerCase();
    if (!isUsableContactEmail(email)) continue;

    const isReconstructed = !rawText.toLowerCase().includes(email);
    if (isReconstructed && !hasCommonTld(email)) continue;
    if (isReconstructed) {
      const parts = splitLocal(email);
      if (parts && BARE_LOCAL_STOPWORDS.has(parts.local)) continue;
    }

    if (seen.has(email)) continue;
    // A posting that mentions a dozen addresses is a list or spam, not a
    // contact; keep scanning no longer.
    if (found.length >= MAX_CANDIDATES) break;
    seen.add(email);
    found.push(email);
  }

  return found;
}

/**
 * The single best contact address in `text`, or null.
 *
 * `hint` lets a candidate matching the client's own name win over a shared
 * inbox. Ties break towards the address that appeared first, which in a job
 * posting is usually the one the client wrote about themselves.
 */
export function extractEmailFromText(
  text: string | null | undefined,
  hint: EmailNameHint = {},
): string | null {
  const candidates = extractEmailsFromText(text);
  const [first, ...rest] = candidates;
  if (!first) return null;

  let best = first;
  let bestScore = score(first, hint);
  for (const candidate of rest) {
    const candidateScore = score(candidate, hint);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}
