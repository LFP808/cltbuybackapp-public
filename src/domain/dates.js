/**
 * Date primitives shared across the domain layer.
 *
 * Every date this app stores for a human — a pickup appointment, a carrier's
 * ETA — is a LOCAL calendar day, not an instant. `toISOString().slice(0, 10)`
 * looks like the obvious way to format one and is wrong: it converts to UTC
 * first, so any time after 8pm Eastern reports tomorrow's date. That mistake
 * has been made twice in this codebase, which is why the helper lives here
 * instead of being rewritten at each call site.
 *
 * "LOCAL" MEANS THE BUSINESS'S LOCAL, NOT THE SERVER'S. The business is in
 * Charlotte, and dayKey() is pinned to its timezone below rather than read off
 * the process clock — because the process clock is UTC on Vercel, and a UTC
 * "today" rolls over at 8pm Eastern. That is not hypothetical: todayKey() feeds
 * the driver gate ("your own stop, today"), so from 8pm every evening a driver
 * standing at a real stop was told it wasn't today's. Pinning it in code, not in
 * a TZ environment variable, so it stays correct even if that variable is never
 * set — the same reason the other guards here are belt-and-braces.
 */

/** The business's timezone. Every "what calendar day is it" answer is in this. */
export const BUSINESS_TZ = "America/New_York";

// en-CA formats as YYYY-MM-DD, and timeZone pins the calendar day to Charlotte
// regardless of where the process runs. Built once — Intl formatters are not
// free to construct.
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The business-local calendar day of an instant, as YYYY-MM-DD.
 *
 * Pinned to BUSINESS_TZ, so it is the SAME answer whether it runs on a staffer's
 * Eastern browser or a UTC serverless function — which is the whole point, since
 * the driver gate compares a stored appointment day against this on the server.
 */
export function dayKey(date) {
  return DAY_KEY_FMT.format(date);
}

// Same construction rationale as DAY_KEY_FMT: built once, pinned to the
// business's clock. hourCycle "h23" rather than hour12:false because the
// latter can still yield "24" at midnight on some ICU versions.
const DAY_MINUTES_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Minutes since midnight IN CHARLOTTE for an instant, 0-1439.
 *
 * The appointment sweep's whole schedule ("from 8am", "30 minutes before a
 * 14:00 pickup") lives on this clock: appointment times are stored as local
 * wall-clock strings, so the only meaningful comparison is against local
 * minutes — the server's own UTC hours are off by four or five depending on
 * the time of year.
 */
export function minutesInBusinessDay(date) {
  const parts = DAY_MINUTES_FMT.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}

/** A new Date `days` after `from`, leaving the original untouched. */
export function addDays(from, days) {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local midnight for a YYYY-MM-DD string, or null if unparseable. */
export function parseLocalDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Human weekday/month/day text for a calendar-day KEY (YYYY-MM-DD),
 * independent of whatever clock runs this code.
 *
 * `parseLocalDate(key).toLocaleDateString(..., { timeZone: BUSINESS_TZ })`
 * LOOKS like the right way to get this and silently is not:
 * parseLocalDate builds the instant at midnight in the CALLER's own local
 * offset (the server's UTC clock, or a viewer's own device clock), and then
 * formatting that instant in a DIFFERENT fixed zone (BUSINESS_TZ) only
 * agrees with the original key when the caller's local offset already
 * happens to be Eastern. Everywhere else - a Vercel function (UTC), or a
 * viewer whose device is set to, say, Asia/Manila - it can roll the
 * displayed day back by one, which is exactly how a Saturday appointment
 * read "Friday" on a remote VA's screen (2026-10-03).
 *
 * Fixed the same way addDaysToKey/mondayIndexOfKey above sidestep the exact
 * same trap: anchor the key to UTC midnight (keyToUtcMs - pure calendar
 * math, never anyone's wall clock) and format that SAME instant in UTC, so
 * construct and read always agree no matter where this runs.
 */
export function formatKey(key, options) {
  if (!key) return "";
  const ms = keyToUtcMs(key);
  if (Number.isNaN(ms)) return key;
  return new Date(ms).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
}

/** Local midnight for a Date/timestamp. */
export function startOfDay(input) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The last instant of a Date/timestamp's local day. */
export function endOfDay(input) {
  const d = new Date(input);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Weekday as 0-6 with MONDAY as 0.
 *
 * The week starts Monday because the work does — a Sunday-first grid splits a
 * run across two columns. JavaScript numbers Sunday as 0, so `+6 % 7` rotates
 * it to the end.
 */
export function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Local midnight on the Monday of this date's week. */
export function startOfWeek(input) {
  const d = startOfDay(input);
  d.setDate(d.getDate() - mondayIndex(d));
  return d;
}

/** First day of the month containing `input`, at local midnight. */
export function startOfMonth(input) {
  const d = new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The month start `months` away from the one containing `input`.
 *
 * Snaps to the 1st ON PURPOSE — this is bucket arithmetic, not calendar
 * arithmetic. A day-preserving version is a trap (Jan 31 + 1 month lands in
 * March), and both existing callers wanted month starts anyway: the overview's
 * trend buckets and the date-range picker's "this month".
 */
export function addMonths(input, months) {
  const d = new Date(input);
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

/* ---------------- business days ---------------- */

// The mail-in reminder countdowns run on BUSINESS days (Jaime, 2026-08-01): a
// customer told "drop the box off" on Friday hasn't ignored two reminders by
// Monday morning. A business day is a Mon-Fri calendar day in BUSINESS_TZ;
// holidays are deliberately not modelled — that means maintaining a holiday
// table forever, and a nudge landing on Labor Day is a smaller cost.
//
// Both helpers work on day-key LABELS rather than instants: the keys are
// already pinned to Charlotte, and stepping a pure calendar date in UTC has no
// DST to trip over — naive +86400000 stepping skips an Eastern calendar day
// once a year, for instants in the last hour before a spring-forward midnight.

const DAY_MS = 86400000;

/** A day key's calendar date as UTC midnight ms — pure date arithmetic space. */
function keyToUtcMs(key) {
  return Date.parse(`${key}T00:00:00Z`);
}

/**
 * A day key shifted by whole calendar days, as pure date-string arithmetic —
 * no viewer clock involved. For stepping a rolling window of BUSINESS-TZ days
 * (the booking strip's "7 days from here", its Earlier/Later paging): doing
 * that step as `new Date(y, m, d + n)` instead uses whatever timezone the
 * code happens to run in, and then re-labelling the result with dayKey() can
 * land it on the wrong side of the Eastern day boundary — same trap as a
 * UTC "today" (see file header), just triggered by the VIEWER'S clock
 * instead of the server's. Stepping the key string sidesteps it entirely.
 */
export function addDaysToKey(key, days) {
  return new Date(keyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Weekday as 0-6 with MONDAY as 0, for a calendar-day KEY rather than an
 * instant — the key-string sibling of mondayIndex() above, for the same
 * viewer-clock reason addDaysToKey exists. Reads UTC getDay() on the key's
 * own UTC-midnight representation (pure calendar math — the key was never
 * anyone's wall clock to begin with), not local getDay() on a constructed
 * Date, which would reintroduce exactly the bug this file exists to avoid.
 */
export function mondayIndexOfKey(key) {
  return (new Date(keyToUtcMs(key)).getUTCDay() + 6) % 7;
}

function isWeekendUtcMs(ms) {
  const dow = new Date(ms).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Whole business days from `from`'s calendar day (EXCLUSIVE) through `to`'s
 * (INCLUSIVE), judged in BUSINESS_TZ. Same instant to same instant is 0; any
 * instant on a Friday to any instant on the following Monday is 1.
 *
 * The inclusive end keeps `>= N` meaning "on day N it counts" — the rule the
 * calendar-ms countdowns had (see hasNotShipped in orders.js) — and it means
 * a threshold is only ever first crossed on a weekday, so the daily sweep
 * finds nothing newly due on weekends.
 */
export function businessDaysBetween(from, to) {
  const a = keyToUtcMs(dayKey(new Date(from)));
  const b = keyToUtcMs(dayKey(new Date(to)));
  let count = 0;
  for (let t = a + DAY_MS; t <= b; t += DAY_MS) {
    if (!isWeekendUtcMs(t)) count += 1;
  }
  return count;
}

/**
 * An instant ON the `n`th business day after `from`'s calendar day, for
 * screens that show a countdown's deadline as a date.
 *
 * NOON UTC of that day on purpose. It is 7-8am in Charlotte, so the instant
 * names the same calendar day in UTC and Eastern (midnight UTC is the
 * previous Eastern evening — the trap at the top of this file), and it falls
 * before the 15:00 UTC reminder sweep, so the sweep acts on the very day the
 * screen and the warning text named.
 */
export function nthBusinessDayAfter(from, n) {
  let t = keyToUtcMs(dayKey(new Date(from)));
  let left = n;
  while (left > 0) {
    t += DAY_MS;
    if (!isWeekendUtcMs(t)) left -= 1;
  }
  return t + DAY_MS / 2;
}

/**
 * Sort key for an appointment within its day, in minutes since midnight.
 *
 * Pickup times are free text ("14:00", "2pm", ""), so anything unparseable
 * sorts LAST rather than scrambling the run.
 *
 * This has to be shared, because the obvious alternative is wrong in a way that
 * looks fine: comparing the strings puts "14:00" before "9:30", since "1" sorts
 * before "9". The calendar did exactly that while the run sheet ranked by
 * minutes, so one day's stops appeared in two different orders depending on
 * which screen a driver opened.
 */
export function timeRank(pickupTime) {
  const m = String(pickupTime || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Compare two free-text appointment times; unparseable ones sort last. */
export function byTime(a, b) {
  return timeRank(a) - timeRank(b);
}
