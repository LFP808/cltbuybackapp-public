/**
 * Date ranges, for every screen that asks "when".
 *
 * There were two of these: the overview resolved month/30d/90d/ytd from URL
 * params, and the orders list had its own day/week/month presets in component
 * state. Same idea, two vocabularies, and "this month" was free to mean
 * different things in each. One list of ranges, one resolver, and each screen
 * says which of them it offers.
 *
 * Every range is CLOSED at both ends. The overview never needed an end —
 * nothing is created in the future, so `to = now` was harmless — but orders
 * are dated by appointment, and next month's pickup would otherwise sit inside
 * "This month" purely for being after the 1st.
 */

import { parseLocalDate, endOfDay, startOfWeek, startOfMonth, addMonths, addDays } from "./dates";

const DAY = 86400000;

export const RANGES = [
  { key: "day", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  // Orders only: the overview measures what happened, and nothing has happened
  // in the future yet.
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range" },
];

/** Look up a range's label without re-deriving it. */
export function labelFor(key) {
  return RANGES.find((r) => r.key === key)?.label || "All time";
}

/**
 * Resolve a selection into a concrete window.
 *
 * @param {{range?:string, from?:string, to?:string}} selection  from/to are YYYY-MM-DD
 * @param {number} [now]
 * @returns {{ from:number, to:number, key:string, label:string }}
 */
export function resolveRange({ range, from, to } = {}, now = Date.now()) {
  const key = range || (from || to ? "custom" : "all");
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const midnight = d.getTime();
  const endOfToday = midnight + DAY - 1;

  let start;
  let end = endOfToday;
  let label = labelFor(key);

  switch (key) {
    case "day":
      start = midnight;
      break;
    case "week": {
      // Ends at the real end of Sunday rather than start + 7×86400000ms, which
      // lands an hour out in a week containing a DST change.
      const weekStart = startOfWeek(d);
      start = weekStart.getTime();
      end = endOfDay(addDays(weekStart, 6)).getTime();
      break;
    }
    case "month":
      start = startOfMonth(d).getTime();
      end = addMonths(d, 1).getTime() - 1;
      break;
    case "30d":
      start = midnight - 29 * DAY;
      break;
    case "90d":
      start = midnight - 89 * DAY;
      break;
    case "ytd":
      start = new Date(d.getFullYear(), 0, 1).getTime();
      break;
    case "upcoming":
      start = midnight + DAY;
      end = Infinity;
      break;
    case "custom":
      start = from ? dayStartMs(from) : 0;
      end = to ? dayEndMs(to) : endOfToday;
      label = customLabel(start, end, Boolean(from || to));
      break;
    case "all":
    default:
      start = 0;
      end = Infinity;
      break;
  }

  // A "custom" range with neither end filled in is just everything, and saying
  // so is friendlier than an empty date chip.
  const settled = key === "custom" && !from && !to ? "all" : key;
  return { from: start, to: end, key: settled, label: settled === "all" ? "All time" : label };
}

/** Whether a timestamp sits inside a resolved range. */
export function inRange(at, range) {
  return at >= range.from && at <= range.to;
}

/** YYYY-MM-DD -> the first instant of that local day, or NaN if unparseable. */
function dayStartMs(value) {
  const d = parseLocalDate(value);
  return d ? d.getTime() : NaN;
}

/** YYYY-MM-DD -> the last instant of that local day, or NaN if unparseable. */
function dayEndMs(value) {
  const d = parseLocalDate(value);
  return d ? endOfDay(d).getTime() : NaN;
}

function customLabel(start, end, hasBounds) {
  if (!hasBounds) return "All time";
  const fmt = (ms) =>
    Number.isFinite(ms) && ms > 0
      ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : null;
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a} – ${b}`;
  return a ? `Since ${a}` : `Until ${b}`;
}
