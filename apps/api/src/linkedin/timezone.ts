/**
 * Wall-clock arithmetic for scheduled posts.
 *
 * A post stores an absolute instant plus the IANA zone that instant was chosen
 * in, because "3pm" means 3pm where Dan is. Dragging a card to another day in
 * the calendar therefore cannot be `instant + n * 86400000`: across a DST
 * boundary that silently turns a 9am post into an 8am one. It has to be
 * "same wall clock, different date, resolved in the post's own zone".
 *
 * Done with `Intl` rather than a date library so this adds no dependency —
 * `date-fns@4` is present but its timezone support is a separate package.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far `timeZone` is ahead of UTC at this instant, in milliseconds.
 *
 * Formats the instant into the zone's own calendar fields, reads those fields
 * back as if they were UTC, and takes the difference. That round trip is what
 * makes it correct across DST without a table of rules.
 */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const field = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    // hour12:false yields 24 for midnight in some ICU versions.
    field("hour") % 24,
    field("minute"),
    field("second"),
  );

  return asIfUtc - date.getTime();
}

/** Is this a zone Node actually knows? Guards user-supplied strings. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" for the day this instant falls on, in `timeZone`. */
export function zonedDayKey(date: Date, timeZone: string): string {
  // en-CA formats as ISO, which is exactly the shape the API takes back.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The wall-clock time this instant shows in `timeZone`. */
export function zonedClock(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const field = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return { hour: field("hour") % 24, minute: field("minute") };
}

/**
 * The instant at which `timeZone`'s clock reads this date and time.
 *
 * Two passes: the first guess uses the offset in force at the naive instant,
 * which is wrong only when the guess lands on the far side of a transition; the
 * second pass corrects it. A time inside a spring-forward gap (02:30 on a day
 * the clocks jump 02:00 → 03:00) does not exist, and resolves to the instant
 * just before the jump — 01:30 local. Nobody schedules there deliberately; it
 * matters only that it lands somewhere sane rather than throwing.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = naive - offsetMs(new Date(naive), timeZone);
  const corrected = naive - offsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/**
 * Resolve a wall-clock string ("YYYY-MM-DDTHH:mm") in `timeZone`.
 *
 * This is what an `<input type="datetime-local">` produces, and it is a LOCAL
 * time with no offset attached. Passing it to `new Date()` in the browser
 * silently resolves it in the browser's zone, which is wrong the moment the
 * person scheduling is not sitting in the timezone they picked — an agency in
 * Kolkata scheduling 9am New York got 11:30pm the previous day. So the string
 * travels to the server as text and is resolved against the post's own zone
 * here, in the same place every other wall-clock conversion happens.
 */
export function parseZonedLocal(local: string, timeZone: string): Date {
  const m = ISO_LOCAL.exec(local.trim());
  if (!m) {
    throw new Error("Expected a local time as YYYY-MM-DDTHH:mm");
  }
  const [, year, month, day, hour, minute] = m;
  return zonedTimeToInstant(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    timeZone,
  );
}

/** Where a post dragged out of the unscheduled tray lands, in its own zone. */
export const DEFAULT_DROP_HOUR = 9;

/**
 * Move a post to `dateKey` ("YYYY-MM-DD") keeping the time of day it already
 * had. A post with no time yet gets {@link DEFAULT_DROP_HOUR}.
 *
 * This is the whole reason drag-to-reschedule sends a date rather than an
 * instant: the client does not have to reason about offsets at all.
 */
export function reanchorToDate(
  current: Date | null,
  timeZone: string,
  dateKey: string,
): Date {
  if (!ISO_DATE.test(dateKey)) {
    throw new Error("Expected a date as YYYY-MM-DD");
  }
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const { hour, minute } = current
    ? zonedClock(current, timeZone)
    : { hour: DEFAULT_DROP_HOUR, minute: 0 };
  return zonedTimeToInstant(year, month, day, hour, minute, timeZone);
}
