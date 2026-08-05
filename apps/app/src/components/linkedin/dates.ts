/**
 * Calendar arithmetic for the scheduler.
 *
 * A post carries its own timezone, so every "which day is this on?" question
 * resolves through that zone, never the browser's. Moving a post to another day
 * is deliberately NOT done here — the client sends a plain "YYYY-MM-DD" and the
 * server re-anchors the clock time, because that is the part that has to
 * survive a DST boundary.
 */

/** "YYYY-MM-DD" for the day this instant falls on, in `timeZone`. */
export function dayKeyInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }
}

export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Clock only, for dense calendar chips: "9:00am". */
export function timeInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    })
      .format(new Date(iso))
      .replace(/\s/g, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

/** The full scheduled moment, in the post's own zone. */
export function whenInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** An event in the reader's own time — timeline entries, "created …". */
export function whenLocal(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(key: string): string {
  const [y = 2026, m = 1] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function shiftMonth(key: string, delta: number): string {
  const [y = 2026, m = 1] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export type GridDay = { key: string; day: number; inMonth: boolean };

/** The Monday-first grid a month is drawn on, always whole weeks. */
export function monthGridDays(month: string): GridDay[] {
  const [y = 2026, m = 1] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  // getDay() is Sunday-first; shift so Monday starts the week.
  const lead = (first.getDay() + 6) % 7;
  const days: GridDay[] = [];
  const cursor = new Date(y, m - 1, 1 - lead);
  for (let i = 0; i < 42; i++) {
    days.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
        cursor.getDate(),
      ).padStart(2, "0")}`,
      day: cursor.getDate(),
      inMonth: cursor.getMonth() === m - 1,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  // Drop a trailing all-spill week rather than draw an empty row.
  while (days.length > 35 && !days.slice(-7).some((d) => d.inMonth)) {
    days.length -= 7;
  }
  return days;
}

/**
 * The window to fetch for a month grid.
 *
 * The server filters on the absolute instant, but a post is bucketed by its own
 * zone, which can sit up to ~14h either side of UTC. Two days of slack means a
 * card near a grid edge is never missing from the cell it belongs in; the
 * client then buckets precisely.
 */
export function monthGridRange(month: string): { from: string; to: string } {
  const days = monthGridDays(month);
  const firstKey = days[0]?.key ?? `${month}-01`;
  const lastKey = days[days.length - 1]?.key ?? `${month}-28`;
  const [fy = 2026, fm = 1, fd = 1] = firstKey.split("-").map(Number);
  const [ly = 2026, lm = 1, ld = 28] = lastKey.split("-").map(Number);
  const SLACK = 2 * 24 * 3600 * 1000;
  return {
    from: new Date(Date.UTC(fy, fm - 1, fd) - SLACK).toISOString(),
    to: new Date(Date.UTC(ly, lm - 1, ld, 23, 59, 59) + SLACK).toISOString(),
  };
}

/** Long day heading for the agenda view. */
export function dayHeading(dayKey: string): string {
  const [y = 2026, m = 1, d = 1] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * `datetime-local` value for an instant, rendered in the POST's zone.
 *
 * Not the browser's. The field sits directly under a timezone picker, so the
 * clock it shows has to be the clock that picker names — otherwise someone
 * scheduling 9am New York from Kolkata reads back 6:30pm and "corrects" it.
 * The value produced here is sent straight back as `scheduledLocal` and
 * resolved against the same zone on the server.
 */
export function toZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    // hour12:false yields "24" for midnight in some ICU versions.
    const hour = String(Number(get("hour")) % 24).padStart(2, "0");
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
  } catch {
    return "";
  }
}

export function actorName(email: string | null): string {
  return email ? (email.split("@")[0] ?? email) : "Someone";
}
