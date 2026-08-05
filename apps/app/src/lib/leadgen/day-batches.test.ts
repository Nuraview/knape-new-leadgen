import { describe, expect, it } from "vitest";
import type { BatchOption } from "@/fetchers/leadgen/types";
import { buildDayChips, localIsoDate, shiftDays } from "./day-batches";

const batch = (value: string, count: number): BatchOption => ({
  value,
  label: value,
  count,
  kind: value === "original" ? "original" : "date",
});

describe("localIsoDate", () => {
  it("uses the local calendar day, not UTC", () => {
    // 2026-08-03 23:30 local. Anywhere east of UTC this is already the 4th in
    // UTC, and anywhere west of UTC an early-morning local time is still the
    // previous day there. toISOString() would disagree with the scrape run's
    // own label, and "Today" would silently show zero leads.
    const lateEvening = new Date(2026, 7, 3, 23, 30, 0);
    expect(localIsoDate(lateEvening)).toBe("2026-08-03");

    const earlyMorning = new Date(2026, 7, 3, 0, 15, 0);
    expect(localIsoDate(earlyMorning)).toBe("2026-08-03");
  });

  it("zero-pads month and day", () => {
    expect(localIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("shiftDays", () => {
  it("crosses a month boundary", () => {
    expect(localIsoDate(shiftDays(new Date(2026, 7, 1), -1))).toBe("2026-07-31");
  });

  it("crosses a year boundary", () => {
    expect(localIsoDate(shiftDays(new Date(2026, 0, 1), -2))).toBe("2025-12-30");
  });

  it("does not mutate the date it was given", () => {
    const today = new Date(2026, 7, 3);
    shiftDays(today, -5);
    expect(localIsoDate(today)).toBe("2026-08-03");
  });
});

describe("buildDayChips", () => {
  const monday = new Date(2026, 7, 3); // the day of the call

  it("labels today, yesterday and the day before", () => {
    const chips = buildDayChips([], monday);
    expect(chips.map((c) => c.label)).toEqual([
      "Today",
      "Yesterday",
      "Day before",
      "Full list",
    ]);
    expect(chips.slice(0, 3).map((c) => c.value)).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });

  it("carries the count for each day from the batch list", () => {
    const chips = buildDayChips(
      [batch("2026-08-03", 173), batch("2026-08-02", 40), batch("2026-08-01", 62)],
      monday,
    );
    expect(chips.slice(0, 3).map((c) => c.count)).toEqual([173, 40, 62]);
  });

  it("still shows a day that had no scrape run, as zero", () => {
    // VK found out ingestion had stopped only by noticing timestamps were not
    // moving. A missing chip reads as a UI bug; "Today 0" is the actual news.
    const chips = buildDayChips([batch("2026-08-01", 62)], monday);
    expect(chips[0]).toMatchObject({ label: "Today", count: 0 });
    expect(chips[1]).toMatchObject({ label: "Yesterday", count: 0 });
    expect(chips[2]).toMatchObject({ label: "Day before", count: 62 });
  });

  it("full list is unfiltered and counts everything, not just the three days", () => {
    const chips = buildDayChips(
      [
        batch("2026-08-03", 173),
        batch("2026-08-02", 40),
        // Most of this account's pipeline predates the daily scrape. Summing
        // only the day chips would understate it badly.
        batch("original", 4_800),
      ],
      monday,
    );
    const full = chips[chips.length - 1];
    expect(full).toMatchObject({ label: "Full list", value: "" });
    expect(full.count).toBe(5_013);
  });

  it("prefers an explicit total over summing the batches", () => {
    const chips = buildDayChips([batch("2026-08-03", 173)], monday, 5_200);
    expect(chips[chips.length - 1].count).toBe(5_200);
  });

  it("weekend example from the call: Monday shows Sunday and Saturday", () => {
    // "day before yesterday, meaning Saturday and Friday" — said on a Sunday.
    // Anchored on Monday 2026-08-03, the two prior chips are Sun 2nd and Sat 1st.
    const chips = buildDayChips([], monday);
    expect(new Date(2026, 7, 2).getDay()).toBe(0); // Sunday
    expect(new Date(2026, 7, 1).getDay()).toBe(6); // Saturday
    expect(chips[1].value).toBe("2026-08-02");
    expect(chips[2].value).toBe("2026-08-01");
  });
});
