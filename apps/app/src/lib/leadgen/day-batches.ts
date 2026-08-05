import type { BatchOption } from "@/fetchers/leadgen/types";

/**
 * The Today / Yesterday / Day-before / Full list chips.
 *
 * VK, 2026-08-03: "Full list opens up this. This is not what I had requested,
 * right? Full list should show today, yesterday, should have day before
 * yesterday. So for example, day before yesterday, meaning Saturday and
 * Friday."
 *
 * There is no upstream endpoint for named day views, and adding one would be
 * the wrong shape — the cockpit already stamps every lead with the ISO date of
 * the scrape run that first found it (`accounts.data_batch`), and exposes the
 * distinct values with counts at GET /api/pipeline/batches. The chips are
 * therefore a presentation of data that already exists.
 *
 * Deliberately computed against the LOCAL calendar day, not UTC. "Today" means
 * the operator's today; a UTC boundary would relabel the current day's leads as
 * yesterday for anyone west of Greenwich part of the evening, which is exactly
 * the sort of thing that gets reported as "leads went missing".
 */

export type DayChip = {
  /** Passed to GET /api/accounts as `data_batch`. Empty means no filter. */
  value: string;
  label: string;
  count: number;
};

/** Local-calendar ISO date (YYYY-MM-DD), matching how data_batch is stamped. */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `offset` days before `today`, on the local calendar. */
export function shiftDays(today: Date, offset: number): Date {
  const shifted = new Date(today);
  shifted.setDate(shifted.getDate() + offset);
  return shifted;
}

/**
 * Builds the chip row.
 *
 * `today` is injected rather than read from the clock so the behaviour is
 * testable across month and year boundaries, and so a long-lived tab does not
 * keep rendering yesterday's labels after midnight.
 *
 * A day with no scrape run still gets a chip, showing 0. Hiding it would be
 * worse: an absent "Today" reads as a UI bug, whereas "Today 0" is the actual
 * news — VK found out ingestion had stopped only by noticing timestamps had
 * stopped moving.
 */
export function buildDayChips(
  batches: BatchOption[],
  today: Date,
  totalCount?: number,
): DayChip[] {
  const byValue = new Map(batches.map((b) => [b.value, b.count]));

  const named: DayChip[] = [
    { offset: 0, label: "Today" },
    { offset: -1, label: "Yesterday" },
    { offset: -2, label: "Day before" },
  ].map(({ offset, label }) => {
    const value = localIsoDate(shiftDays(today, offset));
    return { value, label, count: byValue.get(value) ?? 0 };
  });

  /*
   * "Full list" carries the count of EVERY lead, including the "original"
   * pre-scrape import and any unlabelled rows — not the sum of the three day
   * chips. Summing them would understate the pipeline by however many leads
   * predate the daily scrape, which on this account is most of them.
   */
  const full: DayChip = {
    value: "",
    label: "Full list",
    count:
      totalCount ?? batches.reduce((sum, batch) => sum + batch.count, 0),
  };

  return [...named, full];
}
