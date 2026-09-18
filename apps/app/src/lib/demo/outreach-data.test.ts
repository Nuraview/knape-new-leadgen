import { describe, expect, it } from "vitest";
import {
  demoDailySends,
  demoEmailStats,
  demoEngagement,
  demoRecent,
  demoSentRows,
  demoStep,
} from "@/lib/demo/outreach-data";

describe("demo outreach dataset", () => {
  it("matches the brief: 50 today, 50 yesterday, 30 and 30", () => {
    const d = demoDailySends();
    expect(d.today).toBe(50);
    expect(d.yesterday).toBe(50);
    // days[] is oldest-first for the chart
    expect(d.days.map((x) => x.sent)).toEqual([30, 30, 50, 50]);
    expect(d.sent_total).toBe(160);
  });

  it("follow-ups are the previous day's first contacts", () => {
    const d = demoDailySends();
    expect(d.followups_today).toBe(50);
    expect(d.followups_yesterday).toBe(30);
    expect(d.followups_total).toBe(110);
  });

  it("is 48% opened, 0% clicked, 4% bounced", () => {
    const { window: w } = demoEmailStats();
    expect(w.open_rate).toBe(48);
    expect(w.click_rate).toBe(0);
    expect(w.bounce_rate).toBe(4);
    expect(w.opened).toBe(77);
    expect(w.clicked).toBe(0);
    expect(w.bounced).toBe(6);
  });

  it("counts new companies emailed as first contacts", () => {
    expect(demoEmailStats().window.sent).toBe(160);
  });

  it("the list totals agree with the headline tiles", () => {
    const rows = demoSentRows();
    expect(rows).toHaveLength(160);
    expect(rows.filter((r) => (r.open_count ?? 0) > 0)).toHaveLength(77);
    expect(rows.filter((r) => r.bounced === 1)).toHaveLength(6);
    expect(rows.filter((r) => (r.click_count ?? 0) > 0)).toHaveLength(0);
  });

  it("never shows a bounced email as opened", () => {
    const bad = demoSentRows().filter(
      (r) => r.bounced === 1 && (r.open_count ?? 0) > 0,
    );
    expect(bad).toEqual([]);
  });

  it("is deterministic across calls", () => {
    expect(demoRecent(0, 5).items.map((r) => r.id)).toEqual(
      demoRecent(0, 5).items.map((r) => r.id),
    );
  });

  it("paginates the sent log", () => {
    const page = demoRecent(100, 100);
    expect(page.total).toBe(160);
    expect(page.items).toHaveLength(60);
  });

  it("engagement rows use the cockpit's own column names", () => {
    // to_email / bounce_info, not email / reason. When these drifted the
    // dashboard printed the literal string "undefined" and linked to
    // mailto:undefined.
    const opened = demoEngagement("opened").items[0];
    expect(opened).toHaveProperty("to_email");
    expect(String(opened.to_email)).toContain("@");
    expect(opened).not.toHaveProperty("email");

    const bounced = demoEngagement("bounced").items[0];
    expect(bounced).toHaveProperty("bounce_info");
    expect(bounced).not.toHaveProperty("reason");
  });

  it("clicked engagement is always empty", () => {
    expect(demoEngagement("clicked").items).toEqual([]);
    expect(demoEngagement("opened").items.length).toBeGreaterThan(0);
    expect(demoEngagement("bounced").items).toHaveLength(6);
  });

  it("serves plain-text bodies signed the way the pipeline now sends", () => {
    const step = demoStep(demoSentRows()[0].id);
    expect(step.html).toBe("");
    expect(step.body).toContain("Peter Wuensch");
    expect(step.body).toContain("Knape & Associates");
    expect(step.body).toContain("peter@knapesolutions.com");
    expect(step.body).not.toContain("<");
  });
});

describe("the demo gate", () => {
  it("is OFF unless the build set VITE_DEMO_DATA=true", async () => {
    // The most important assertion in this file. If this ever passes as true
    // without the flag, every outreach figure in a production build is
    // invented, which is the one outcome this whole module must not allow.
    const { demoDataEnabled } = await import("@/lib/demo/enabled");
    expect(import.meta.env.VITE_DEMO_DATA).toBeUndefined();
    expect(demoDataEnabled).toBe(false);
  });

  it("serves nothing for paths it does not own", async () => {
    const { demoResponse } = await import("@/lib/demo/responses");
    // undefined means "fall through to the real API" — so a demo build shows
    // real data everywhere except the outreach screens, never silent blanks.
    expect(demoResponse("/api/accounts", undefined)).toBeUndefined();
    expect(demoResponse("/api/leads/funnel", undefined)).toBeUndefined();
    expect(demoResponse("/api/settings", undefined)).toBeUndefined();
  });

  it("owns exactly the outreach read paths", async () => {
    const { demoResponse } = await import("@/lib/demo/responses");
    expect(demoResponse("/api/emails/stats", { days: 7 })).toBeDefined();
    expect(demoResponse("/api/emails/recent", { offset: 0 })).toBeDefined();
    expect(demoResponse("/api/emails/engagement", { kind: "opened" })).toBeDefined();
    expect(demoResponse("/api/emails/bounced", undefined)).toBeDefined();
    expect(demoResponse("/api/emails/step/4200", undefined)).toBeDefined();
  });

  it("reads a query string baked into the path", async () => {
    const { demoResponse } = await import("@/lib/demo/responses");
    const r = demoResponse<{ items: unknown[] }>(
      "/api/emails/recent?limit=5&offset=0",
      undefined,
    );
    expect(r?.items).toHaveLength(5);
  });
});
