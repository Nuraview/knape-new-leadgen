// Lead enrichment waterfall — deterministic, cheap pipeline for the
// crmLeads table. Distinct from the agent-enrichment-strategy.ts (which
// uses Claude+E2B+Firecrawl on Targets/Contacts at ~$0.10–0.30/run).
//
// Steps (cheapest first; each step's output unlocks the next):
//   1. Discovery   — serper.dev: LinkedIn URL + company domain
//   2. Email find  — Prospeo (primary) → Findymail (fallback)
//   3. Email verify — MillionVerifier; only persist as primary if "ok"/"good"
//   4. (deep mode) Mobile phone — Prospeo mobile-finder (~$0.39, gated)
//
// Per-lead cost target: ~$0.05 standard, ~$0.44 deep.
//
// Returns a structured object the Inngest function maps onto crmLeads
// columns + writes to the crm_Lead_Enrichment audit row. The strategy
// itself does not touch the DB — that's the function's job (transactional).

import {
  searchLinkedInProfile,
  searchCompanyDomain,
  normalizeDomain,
} from "@/lib/enrichment/services/serper";
import {
  findEmailViaProspeo,
  findMobileViaProspeo,
  type ProspeoEmailResult,
  type ProspeoMobileResult,
} from "@/lib/enrichment/services/prospeo";
import { findEmailViaFindymail } from "@/lib/enrichment/services/findymail";
import {
  scrapeLinkedInProfileViaApify,
  findEmailViaApify,
  type ApifyLinkedInProfile,
  type ApifyEmailResult,
} from "@/lib/enrichment/services/apify";
import {
  enrichViaContactOut,
  findLinkedInByEmailViaContactOut,
  searchDecisionMakerViaContactOut,
  type ContactOutResult,
  type ContactOutEmailLookup,
  type ContactOutSearchResult,
} from "@/lib/enrichment/services/contactout";
import {
  verifyEmailViaMillionVerifier,
  isVerifiedDeliverable,
  type MillionVerifierResult,
} from "@/lib/enrichment/services/millionverifier";

// Per-action cost estimates (USD). These are conservative averages used
// for the running daily-budget check — we don't try to detect Prospeo's
// "free on null" exactly, since over-counting is the safe direction.
const COST = {
  serperQuery: 0.001,
  prospeoEmailHit: 0.039, // only charged on valid hits
  findymailEmailHit: 0.049, // primary plan rate
  millionVerifierVerify: 0.004,
  prospeoMobileHit: 0.39,
  // Apify actors bill per result / compute-unit and vary by actor; these
  // are rough averages — they only feed the over-counting daily-budget
  // tally (the same conservative approach noted above).
  apifyLinkedinRun: 0.05,
  apifyEmailRun: 0.03,
  // ContactOut consumes credits per call. Rough averages — only feed the
  // over-counting daily-budget tally; not a billing source of truth.
  contactOutEnrich: 0.15,
  contactOutEmailLookup: 0.01,
  // Search by company + decision-maker title — pulls 1 search + 1 email
  // + 1 phone credit when reveal_info=true. Used only for "company but
  // no name" leads that would otherwise be unenrichable.
  contactOutSearch: 0.25,
} as const;

export type LeadWaterfallMode = "auto" | "manual" | "deep";

export interface LeadWaterfallInput {
  // Required.
  company: string;
  // Optional (we'll search wider when missing).
  jobTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  // From sourcePayload.client_location — used to bias serper geolocation.
  country: string | null;
  // Existing lead values — we never overwrite a non-empty field, mirroring
  // the contact-enrichment pattern in inngest/functions/enrich-contact.ts.
  existing: {
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
  };
}

export interface LeadWaterfallResult {
  found: {
    linkedinUrl: string | null;
    companyDomain: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    emailVerified: boolean;
    phone: string | null;
  };
  // Step-by-step debug payload — written verbatim into
  // crm_Lead_Enrichment.result (jsonb) for auditability.
  trace: {
    serper: {
      linkedinSearchHit: { url: string; titleSnippet: string | null } | null;
      domainSearchHit: string | null;
    };
    prospeo: {
      emailResult: ProspeoEmailResult | null;
      mobileResult: ProspeoMobileResult | null;
    } | null;
    findymail: { triedFallback: boolean; result: unknown } | null;
    millionverifier: MillionVerifierResult | null;
    apify: {
      linkedin: ApifyLinkedInProfile | null;
      email: ApifyEmailResult | null;
    } | null;
    contactout: ContactOutResult | null;
    contactoutEmailLookup: ContactOutEmailLookup | null;
    contactoutSearch: ContactOutSearchResult | null;
  };
  costUsd: number;
  errors: string[];
}

// Input-quality gate. The waterfall used to fire LinkedIn search on
// company + firstName alone — for Upwork-style data ("Jack" + "KHASH"),
// that returned a random "Jack" from LinkedIn and we treated them as the
// client. Then we'd verify the wrong person's email ($0.156 wasted per
// lead on 2026-05-21). Refuse to start the waterfall unless the input
// actually pins down a specific person.
function hasSufficientInputSignal(input: LeadWaterfallInput): boolean {
  if (input.existing.linkedinUrl) return true; // direct identity
  if (input.existing.email) return true; // can derive identity
  const hasFullName = !!(
    input.firstName &&
    input.firstName.trim().length > 1 &&
    input.lastName &&
    input.lastName.trim().length > 1
  );
  return hasFullName;
}

export class LeadWaterfallStrategy {
  async run(
    input: LeadWaterfallInput,
    mode: LeadWaterfallMode,
  ): Promise<LeadWaterfallResult> {
    const result: LeadWaterfallResult = {
      found: {
        linkedinUrl: null,
        companyDomain: null,
        firstName: null,
        lastName: null,
        email: null,
        emailVerified: false,
        phone: null,
      },
      trace: {
        serper: { linkedinSearchHit: null, domainSearchHit: null },
        prospeo: null,
        findymail: null,
        millionverifier: null,
        apify: null,
        contactout: null,
        contactoutEmailLookup: null,
        contactoutSearch: null,
      },
      costUsd: 0,
      errors: [],
    };

    // Gate: refuse to enrich on weak inputs. `deep` mode bypasses for the
    // rare "I know what I'm doing" reviewer-initiated dig.
    if (mode !== "deep" && !hasSufficientInputSignal(input)) {
      result.errors.push("INSUFFICIENT_INPUT");
      return result;
    }

    // ---- Step 1: Discovery ----------------------------------------------
    // Skip the LinkedIn search when we already have a URL on the lead —
    // saves $0.001 and the inferred name from Prospeo would be less accurate
    // anyway than what's already in our row.
    let linkedinUrl: string | null = input.existing.linkedinUrl;
    let inferredFirst = input.firstName;
    let inferredLast = input.lastName;

    if (!linkedinUrl) {
      const liHit = await searchLinkedInProfile({
        company: input.company,
        jobTitle: input.jobTitle,
        firstName: input.firstName,
        lastName: input.lastName,
        country: input.country,
      });
      result.costUsd += COST.serperQuery;
      result.trace.serper.linkedinSearchHit = liHit;
      if (liHit) {
        linkedinUrl = liHit.url;
        // Try to harvest first/last name from the snippet ("John Smith - VP
        // Eng - Acme | LinkedIn"). Cheap heuristic — only used when the
        // ingest didn't have names, which is the common case for Upwork.
        if (!inferredFirst && !inferredLast && liHit.titleSnippet) {
          const m = liHit.titleSnippet.match(/^([^\-|]+?)\s*[-–|]/);
          if (m) {
            const parts = m[1].trim().split(/\s+/);
            if (parts.length >= 2) {
              inferredFirst = parts[0];
              inferredLast = parts.slice(1).join(" ");
            }
          }
        }
      }
    }

    // Apify LinkedIn layer (env-gated, fail-proof). When we have a
    // profile URL but Serper's snippet didn't yield a name, scrape the
    // profile for first/last/headline (better email-finder inputs) and
    // take an email if the actor surfaces one — still verified below.
    if (linkedinUrl && (!inferredFirst || !inferredLast)) {
      const liProfile = await scrapeLinkedInProfileViaApify({
        linkedinUrl,
        firstName: inferredFirst,
        lastName: inferredLast,
        company: input.company?.trim() || null,
      });
      result.trace.apify = { linkedin: liProfile, email: null };
      if (liProfile) {
        result.costUsd += COST.apifyLinkedinRun;
        if (!inferredFirst && liProfile.firstName) {
          inferredFirst = liProfile.firstName;
        }
        if (!inferredLast && liProfile.lastName) {
          inferredLast = liProfile.lastName;
        }
        if (!input.existing.email && !result.found.email && liProfile.email) {
          result.found.email = liProfile.email;
        }
      }
    }

    result.found.linkedinUrl = linkedinUrl;
    result.found.firstName = inferredFirst;
    result.found.lastName = inferredLast;

    let domain: string | null = null;
    const cleanCompany = input.company?.trim();
    if (cleanCompany) {
      domain = await searchCompanyDomain(cleanCompany);
      result.costUsd += COST.serperQuery;
      result.trace.serper.domainSearchHit = domain;
    }
    result.found.companyDomain = domain;

    // ---- Step 1.7: ContactOut unified enrich ---------------------------
    // LinkedIn-native: ONE call returns work_email + personal_email +
    // phone (and name/headline/company). Most valuable layer when we
    // already have the LinkedIn URL — bypasses 3 downstream steps:
    //   - work_email_status="Verified" lets us skip MillionVerifier
    //   - phone here is free of the deep-mode gate (no Prospeo $0.39)
    //   - work email here usually beats Prospeo's pattern-guessed one
    // The service itself returns null on missing key or insufficient
    // signals; we only avoid the call if we already have both email AND
    // phone on the lead (nothing left to enrich on this axis).
    if (!input.existing.email || !input.existing.phone) {
      const coRes = await enrichViaContactOut({
        linkedinUrl,
        firstName: inferredFirst,
        lastName: inferredLast,
        company: cleanCompany,
        domain,
      });
      result.trace.contactout = coRes;
      if (coRes) {
        result.costUsd += COST.contactOutEnrich;
        if (!input.existing.email && !result.found.email) {
          if (coRes.workEmail) {
            result.found.email = coRes.workEmail;
            result.found.emailVerified = coRes.emailVerified;
          } else if (coRes.personalEmail) {
            result.found.email = coRes.personalEmail;
          }
        }
        if (!input.existing.phone && !result.found.phone && coRes.phone) {
          result.found.phone = coRes.phone;
        }
        // Backfill name from ContactOut if we still don't have one (some
        // Upwork leads come through with first only or neither).
        if ((!inferredFirst || !inferredLast) && coRes.fullName) {
          const parts = coRes.fullName.trim().split(/\s+/);
          if (parts.length >= 2) {
            if (!inferredFirst) inferredFirst = parts[0];
            if (!inferredLast) inferredLast = parts.slice(1).join(" ");
            result.found.firstName = inferredFirst;
            result.found.lastName = inferredLast;
          }
        }
      }
    }

    // ---- Step 1.7b: ContactOut decision-maker search ----------------
    // Company present, but no name AND no LinkedIn URL — the rest of
    // the waterfall is paralysed because every email/phone finder needs
    // either a name or a LinkedIn URL. This is the common "Upwork SMB
    // buyer didn't reveal their identity" case (e.g., a German company
    // posting under just its company name). Ask ContactOut to find the
    // company's likely decision-maker (founder / CEO / owner — the
    // typical SMB hiring contact). reveal_info:true returns name +
    // LinkedIn + work_email + phone in one go, so downstream steps +
    // the lead row populate without further fan-out.
    if (
      !inferredFirst &&
      !inferredLast &&
      !linkedinUrl &&
      !result.found.email &&
      !result.found.phone &&
      (cleanCompany || domain)
    ) {
      const search = await searchDecisionMakerViaContactOut({
        company: cleanCompany,
        domain,
      });
      result.trace.contactoutSearch = search;
      if (search) {
        result.costUsd += COST.contactOutSearch;
        if (search.firstName && !inferredFirst) {
          inferredFirst = search.firstName;
          result.found.firstName = search.firstName;
        }
        if (search.lastName && !inferredLast) {
          inferredLast = search.lastName;
          result.found.lastName = search.lastName;
        }
        if (search.linkedinUrl && !linkedinUrl) {
          linkedinUrl = search.linkedinUrl;
          result.found.linkedinUrl = linkedinUrl;
        }
        if (search.workEmail && !result.found.email) {
          result.found.email = search.workEmail;
          // reveal_info:true returns work emails ContactOut considers
          // actionable; trust them and skip MillionVerifier (mirrors
          // the Step 1.7 enrich workEmail handling).
          result.found.emailVerified = true;
        } else if (search.personalEmail && !result.found.email) {
          result.found.email = search.personalEmail;
        }
        if (search.phone && !result.found.phone) {
          result.found.phone = search.phone;
        }
      }
    }

    // ---- Step 2: Email find ---------------------------------------------
    // Need at least firstName + lastName + (domain OR company) to attempt.
    // Skip entirely when an email already exists on the lead — we don't
    // want to pay to "confirm" a hand-entered address.
    if (input.existing.email) {
      result.found.email = input.existing.email;
      // Skip verification — it's the reviewer's responsibility for manually
      // entered emails.
    } else if (result.found.email) {
      // ContactOut already filled it — fall through to the verify gate.
    } else if (inferredFirst && inferredLast && (domain || cleanCompany)) {
      const prospeoRes = await findEmailViaProspeo({
        firstName: inferredFirst,
        lastName: inferredLast,
        domain,
        company: cleanCompany,
      });
      result.trace.prospeo = {
        emailResult: prospeoRes,
        mobileResult: null,
      };
      if (prospeoRes?.email) {
        // Charged only on hit per Prospeo's single-lookup billing.
        result.costUsd += COST.prospeoEmailHit;
        result.found.email = prospeoRes.email;
      } else if (domain) {
        // Findymail requires a domain — skip if discovery couldn't find one.
        const fmRes = await findEmailViaFindymail({
          firstName: inferredFirst,
          lastName: inferredLast,
          domain,
        });
        result.trace.findymail = { triedFallback: true, result: fmRes };
        if (fmRes?.email) {
          result.costUsd += COST.findymailEmailHit;
          result.found.email = fmRes.email;
        }
      }
      // Last-resort: Apify email actor (env-gated, fail-proof). Only runs
      // if Prospeo + Findymail didn't yield an email. Accepts domain OR
      // company. Whatever it returns still goes through the verify gate.
      if (!result.found.email) {
        const apEmail = await findEmailViaApify({
          firstName: inferredFirst,
          lastName: inferredLast,
          domain,
          company: cleanCompany,
        });
        if (result.trace.apify) {
          result.trace.apify.email = apEmail;
        } else {
          result.trace.apify = { linkedin: null, email: apEmail };
        }
        if (apEmail?.email) {
          result.costUsd += COST.apifyEmailRun;
          result.found.email = apEmail.email;
        }
      }
    } else {
      result.errors.push(
        "email-find skipped: missing first/last name or domain/company",
      );
    }

    // ---- Step 3: Verify email -------------------------------------------
    if (
      result.found.email &&
      result.found.email !== input.existing.email &&
      !result.found.emailVerified
    ) {
      const verRes = await verifyEmailViaMillionVerifier(result.found.email);
      result.costUsd += COST.millionVerifierVerify;
      result.trace.millionverifier = verRes;
      result.found.emailVerified = isVerifiedDeliverable(verRes);
      if (!result.found.emailVerified) {
        // Found-but-undeliverable: keep in trace, but DON'T write to the
        // lead's primary email. The Inngest function inspects emailVerified
        // before mapping into crmLeads.email.
        result.errors.push(
          `verify rejected ${result.found.email}: ${verRes?.result ?? "unknown"}`,
        );
      }
    }

    // ---- Step 4: Phone (deep mode only) ---------------------------------
    if (
      mode === "deep" &&
      !input.existing.phone &&
      !result.found.phone &&
      result.found.linkedinUrl
    ) {
      const mobileRes = await findMobileViaProspeo({
        linkedinUrl: result.found.linkedinUrl,
      });
      if (result.trace.prospeo) {
        result.trace.prospeo.mobileResult = mobileRes;
      } else {
        result.trace.prospeo = {
          emailResult: null,
          mobileResult: mobileRes,
        };
      }
      if (mobileRes?.number) {
        // Mobile is charged on hit.
        result.costUsd += COST.prospeoMobileHit;
        const cc = mobileRes.country_code ? `${mobileRes.country_code} ` : "";
        result.found.phone = `${cc}${mobileRes.number}`.trim();
      }
    }

    // ---- Step 5: Backfill LinkedIn URL from email (ContactOut) ---------
    // If we landed an email but Serper didn't yield a LinkedIn URL, ask
    // ContactOut's email->linkedin endpoint. Cheap (1 credit on hit) and
    // gives the reviewer a profile to click through to.
    if (result.found.email && !result.found.linkedinUrl) {
      const liRes = await findLinkedInByEmailViaContactOut(result.found.email);
      result.trace.contactoutEmailLookup = liRes;
      if (liRes?.linkedinUrl) {
        result.costUsd += COST.contactOutEmailLookup;
        result.found.linkedinUrl = liRes.linkedinUrl;
      }
    }

    // Strip noise from domain (in case serper returned a deep link).
    if (result.found.companyDomain) {
      result.found.companyDomain = normalizeDomain(result.found.companyDomain) ??
        result.found.companyDomain;
    }

    return result;
  }
}

export const COSTS_FOR_DOC = COST;
