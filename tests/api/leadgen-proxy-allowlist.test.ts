import { describe, expect, it } from "vitest";
import { isAllowed } from "../../apps/api/src/leadgen";

/**
 * The lead-gen proxy forwards to a Python service that exposes destructive
 * operations next to read-only ones. These tests pin the allow-list, because
 * the cost of getting it wrong is asymmetric: a missing entry is a 403 someone
 * reports in minutes, while an extra one can erase Dan's pipeline silently.
 */
describe("leadgen proxy allow-list", () => {
  describe("refuses the destructive endpoints", () => {
    /*
     * POST /api/sync runs, in order:
     *   DELETE FROM contacts; DELETE FROM evidence; DELETE FROM accounts;
     * then rebuilds the lead table from an xlsx file (cockpit_api.py:1198).
     *
     * The additive path — merge_records — is what the scrape and enrich
     * endpoints already use, so nothing in the CRM needs this one.
     */
    it("never proxies POST /api/sync", () => {
      expect(isAllowed("POST", "/api/sync")).toBe(false);
    });

    it("does not proxy an unknown upstream route", () => {
      expect(isAllowed("GET", "/api/admin/wipe")).toBe(false);
      expect(isAllowed("POST", "/api/auth/login")).toBe(false);
    });

    /*
     * The method is part of the rule, not decoration. GET /api/accounts is a
     * read; DELETE on the same path would not be, and the cockpit must never
     * receive a verb the CRM did not intend to allow.
     */
    it("does not let an allowed path smuggle in another method", () => {
      expect(isAllowed("GET", "/api/accounts")).toBe(true);
      expect(isAllowed("DELETE", "/api/accounts")).toBe(false);
      expect(isAllowed("POST", "/api/accounts")).toBe(false);
      expect(isAllowed("PATCH", "/api/summary")).toBe(false);
    });
  });

  describe("allows the surfaces the Leads tabs need", () => {
    it("lead board and detail", () => {
      expect(isAllowed("GET", "/api/summary")).toBe(true);
      expect(isAllowed("GET", "/api/accounts")).toBe(true);
      expect(isAllowed("GET", "/api/accounts/42")).toBe(true);
      expect(isAllowed("GET", "/api/accounts/42/contacts")).toBe(true);
    });

    it("the Today / Yesterday / Day-before chips", () => {
      // These render from data_batch counts, which only this endpoint returns.
      expect(isAllowed("GET", "/api/pipeline/batches")).toBe(true);
    });

    it("Live Lead Finder, including its operational triggers", () => {
      expect(isAllowed("GET", "/api/pipeline/status")).toBe(true);
      expect(isAllowed("POST", "/api/pipeline/scrape")).toBe(true);
      expect(isAllowed("POST", "/api/pipeline/enrich")).toBe(true);
      expect(isAllowed("POST", "/api/pipeline/enrich-contacts")).toBe(true);
    });

    it("the Emails tab across all six panes", () => {
      expect(isAllowed("GET", "/api/emails/stats")).toBe(true);
      expect(isAllowed("GET", "/api/emails/approved")).toBe(true);
      expect(isAllowed("POST", "/api/emails/send-approved")).toBe(true);
      expect(isAllowed("GET", "/api/emails/bounced")).toBe(true);
      expect(isAllowed("POST", "/api/emails/bounced/requeue")).toBe(true);
      expect(isAllowed("GET", "/api/emails/inbox")).toBe(true);
      expect(isAllowed("POST", "/api/emails/compose")).toBe(true);
      expect(isAllowed("DELETE", "/api/emails/outbox/7")).toBe(true);
    });

    it("Inboxes, Settings and Inbound", () => {
      expect(isAllowed("GET", "/api/outreach/inboxes")).toBe(true);
      expect(isAllowed("PATCH", "/api/outreach/inboxes/3")).toBe(true);
      expect(isAllowed("GET", "/api/settings")).toBe(true);
      expect(isAllowed("PATCH", "/api/settings")).toBe(true);
      expect(isAllowed("GET", "/api/sample-leads")).toBe(true);
    });

    it("per-lead outreach drafting and approval", () => {
      expect(isAllowed("GET", "/api/leads/9/email")).toBe(true);
      expect(isAllowed("GET", "/api/leads/9/activity")).toBe(true);
      expect(isAllowed("POST", "/api/leads/9/email/draft")).toBe(true);
      expect(isAllowed("POST", "/api/leads/9/email/approve")).toBe(true);
    });

    it("the client's own rating on a lead", () => {
      expect(isAllowed("PUT", "/api/leads/9/rating")).toBe(true);
      // PUT is scoped to /api/leads/ and nothing else.
      expect(isAllowed("PUT", "/api/accounts/9")).toBe(false);
      expect(isAllowed("PUT", "/api/settings")).toBe(false);
    });

    it("health, for the connection banner", () => {
      expect(isAllowed("GET", "/api/health")).toBe(true);
    });

    it("the social content scheduler, including creatives", () => {
      expect(isAllowed("GET", "/api/social/posts")).toBe(true);
      expect(isAllowed("GET", "/api/social/posts/4")).toBe(true);
      expect(isAllowed("POST", "/api/social/posts")).toBe(true);
      expect(isAllowed("POST", "/api/social/posts/4/approve")).toBe(true);
      expect(isAllowed("POST", "/api/social/posts/4/request-changes")).toBe(
        true,
      );
      expect(isAllowed("POST", "/api/social/posts/4/comments")).toBe(true);
      expect(isAllowed("POST", "/api/social/posts/4/media")).toBe(true);
      expect(isAllowed("PATCH", "/api/social/posts/4")).toBe(true);
      expect(isAllowed("DELETE", "/api/social/posts/4")).toBe(true);
      // The creative itself, streamed back through the proxy so the bearer
      // never has to ride in an <img> URL.
      expect(isAllowed("GET", "/api/social/media/4/file")).toBe(true);
      expect(isAllowed("DELETE", "/api/social/media/4")).toBe(true);
    });
  });

  /*
   * Upstream's share routes answer with NO session — the token in the path is
   * the whole credential. They are the one part of that API that contradicts
   * this proxy's contract, so they get their own test rather than relying on
   * the allow-list happening not to match them.
   */
  it("never proxies the unauthenticated share links", () => {
    expect(isAllowed("GET", "/api/social/share/abc123")).toBe(false);
    expect(isAllowed("GET", "/api/social/share/abc123/media/4")).toBe(false);
    expect(isAllowed("POST", "/api/social/posts/4/share")).toBe(false);
    expect(isAllowed("DELETE", "/api/social/posts/4/share")).toBe(false);
  });

  it("never proxies LinkedIn account connection", () => {
    // Not ported: no account has ever been connected, and OAuth redirects
    // through a proxy would land the callback on the wrong origin.
    expect(isAllowed("GET", "/api/social/linkedin/status")).toBe(false);
    expect(isAllowed("GET", "/api/social/linkedin/connect")).toBe(false);
    expect(isAllowed("DELETE", "/api/social/linkedin")).toBe(false);
  });
});
