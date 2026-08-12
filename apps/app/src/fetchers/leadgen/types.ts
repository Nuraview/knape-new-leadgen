/**
 * Shapes returned by the lead-gen cockpit, mirrored from its own
 * frontend/src/types.ts.
 *
 * Hand-mirrored rather than imported: the cockpit is a separate Python + Vite
 * project on a different deploy path, and taking a build-time dependency on it
 * would mean this app could not build without it checked out. It is also
 * temporary — once the cockpit's UI is retired (WP0b) these become the only
 * definition.
 *
 * Field names are the API's, snake_case included. Renaming them here would put
 * a translation layer between the proxy and the components for no benefit, and
 * would hide which fields are actually the upstream's.
 */

export type Account = {
  id: number;
  company: string;
  website: string;
  industry: string;
  /** "City, ST" — schools and coalitions. */
  location?: string;
  /** School enrollment, stored in the legacy headcount column. */
  headcount?: string;
  score: number;
  signal_category: string;
  signal_evidence: string;
  equipment_needs: string;
  company_profile: string;
  lead_source_bucket: string;
  fresh_signal: number;
  /** Serialised ICP factor scores, rendered as the radar chart. */
  swot_json?: string;
  signal_url?: string | null;
  /** When this lead was found: a scrape date "YYYY-MM-DD", "original", or "". */
  data_batch?: string;
  contacts_count?: number;
  emails_count?: number;
  /**
   * The client's own 0–10 verdict, null when nobody has rated this company.
   *
   * Deliberately NOT the ICP score: `score` is what the model inferred from the
   * research, this is what the person who knows the business says. Null and 0
   * are different claims — "not looked at yet" versus "useless" — which is why
   * this is nullable rather than defaulting to 0.
   */
  client_rating?: number | null;
};

export type Person = {
  id: number;
  /** The school this person belongs to, so a row can reach its lead. */
  account_id?: number;
  person_name: string;
  job_title: string;
  email: string;
  linkedin_url?: string;
  source_kind: string;
  confidence: number;
  company: string;
  industry?: string;
  score?: number;
  website?: string;
  signal_evidence?: string;
  signal_url?: string | null;
};

/**
 * Paging envelope on GET /api/accounts.
 *
 * The endpoint pages server-side (cockpit_api.py `_paginate`), defaulting to
 * 500 rows. `page` is the page the server actually served, which is NOT always
 * the one asked for: an out-of-range page clamps to the last real one, so a
 * stale page number in the UI lands on data rather than on nothing. Render the
 * pager from this, not from the requested page.
 */
export type PageEnvelope = {
  total: number;
  /** 1-based, and authoritative — the server may have clamped it. */
  page: number;
  page_size: number;
  pages: number;
};

/** GET /api/accounts — the shape depends on the `mode` parameter. */
export type AccountsResponse =
  | ({ mode: "accounts"; items: Account[] } & PageEnvelope)
  | ({ mode: "people"; items: Person[] } & PageEnvelope);

/**
 * One entry in the scrape-date filter, from GET /api/pipeline/batches.
 *
 * This is the primitive behind the Today / Yesterday / Day-before chips. The
 * cockpit never had named day views — it has `accounts.data_batch`, stamped
 * with the ISO date of the run that first found each lead — so the chips are
 * computed from these values rather than requiring a new endpoint.
 */
export type BatchOption = {
  /** "" | "original" | "2026-06-24" */
  value: string;
  label: string;
  count: number;
  kind: "date" | "original" | "unknown";
};

export type SampleLead = {
  id: number;
  name: string;
  email: string;
  phone: string;
  school: string;
  role: string;
  students_count: string;
  school_type: string;
  notes: string;
  grant_interest: boolean;
  source: string;
  /** Unix seconds. */
  created_at: number;
};
