import { dayKey, byTime, addDaysToKey, mondayIndexOfKey, parseLocalDate, formatKey } from "./dates";

/**
 * Orders as things that happen on a day.
 *
 * Every order is a meetup, so the calendar is simply the appointment book:
 * pickup_date is the day, pickup_time the slot. (The ancestor app also
 * merged carrier ETAs into this stream; with no mail-in there is exactly one
 * date per order and it always means "when we expect to see this person".)
 */

/**
 * `tone` is the chip; `dot` is the same meaning at phone size, where a name
 * would truncate to nothing legible. One kind today; keep the map — a second
 * kind of calendar entry (a buyer dropping by, a bulk seller) is a line
 * here, not a redesign.
 */
export const EVENT_KINDS = {
  office: { label: "Meetup", tone: "bg-accent-l text-accent", dot: "bg-accent/40" },
};

/**
 * The day an order belongs on, or null when it has none yet.
 *
 * A walk-in already happened and an unscheduled order isn't happening —
 * neither belongs on a plan of future work, and both have no pickupDate,
 * which is what this returns.
 */
export function eventDate(order) {
  return order?.pickupDate || null;
}

/** Which kind of thing this is, in calendar terms. */
export function eventKind(order) {
  return "office";
}

/**
 * Group orders by day for a month grid.
 *
 * Cancelled orders are dropped (a voided meetup isn't a day's work, past or
 * future); paid ones stay, so a past day on the calendar shows what actually
 * happened rather than nothing.
 *
 * @param {Array<object>} orders
 * @returns {Map<string, Array<object>>} YYYY-MM-DD -> orders, time-sorted
 */
export function groupByDay(orders = []) {
  const map = new Map();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const day = eventDate(order);
    if (!day) continue;
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(order);
  }
  for (const list of map.values()) {
    // Timed appointments first and in order; an untimed one goes last.
    list.sort((a, b) => byTime(a.pickupTime, b.pickupTime));
  }
  return map;
}

/**
 * The 6x7 grid of days covering a month, including the neighbouring days
 * that fill the first and last weeks.
 *
 * Always six rows. A month that needs five would otherwise change the
 * calendar's height as you page through it, moving everything below it up
 * and down.
 *
 * EVERY CELL'S KEY IS BUSINESS-TZ CALENDAR MATH, not the viewer's clock. This
 * renders client-side, so "the viewer" is whatever timezone the person
 * looking — staffer, or the remote VA — has their OWN device set to.
 * Building each cell as `new Date(y, m, d + i)` and then labelling it with
 * dayKey() would construct that instant at the VIEWER'S local midnight,
 * which a Charlotte-pinned relabel can shift onto the wrong day for anyone
 * whose clock isn't Eastern — an order booked for Saturday rendering under
 * Sunday's column. Stepping day KEYS (addDaysToKey, mondayIndexOfKey) keeps
 * every cell's identity pinned to Charlotte; a Date is built only at the end,
 * purely for displaying that already-correct day (weekday name, day number).
 *
 * @param {number} year
 * @param {number} month 0-11
 * @returns {Array<{ key: string, date: Date, inMonth: boolean, isToday: boolean }>}
 */
export function monthGrid(year, month, today = new Date()) {
  const firstKey = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
  // Monday-first, matching every other week boundary in the app.
  const startKey = addDaysToKey(firstKey, -mondayIndexOfKey(firstKey));
  const todayKey = dayKey(today);

  return Array.from({ length: 42 }, (_, i) => {
    const key = addDaysToKey(startKey, i);
    const date = parseLocalDate(key);
    return {
      key,
      date,
      inMonth: date.getMonth() === month,
      isToday: key === todayKey,
    };
  });
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The seven days of the week containing `anchor`, Monday-first like every
 * other week boundary in the app. Same viewer-clock caution as monthGrid
 * above: `anchor` is converted to a business-day KEY immediately (dayKey),
 * then every cell is pure key arithmetic from there.
 *
 * @returns {Array<{ key: string, date: Date, isToday: boolean }>}
 */
export function weekDays(anchor, today = new Date()) {
  const anchorKey = dayKey(anchor);
  const startKey = addDaysToKey(anchorKey, -mondayIndexOfKey(anchorKey));
  const todayK = dayKey(today);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(startKey, i);
    return { key, date: parseLocalDate(key), isToday: key === todayK };
  });
}

/** "Aug 10 – 16" or "Aug 31 – Sep 6" — the week header. */
export function weekLabel(cells) {
  const first = cells[0];
  const last = cells[cells.length - 1];
  // formatKey on the KEYS, not the .date Date objects + an explicit
  // timeZone - that pairing only agrees with the key when the viewer's own
  // clock happens to already be Eastern. See domain/dates.js#formatKey.
  const sameMonth = first.date.getMonth() === last.date.getMonth();
  const a = formatKey(first.key, { month: "short", day: "numeric" });
  const b = formatKey(last.key, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${a} - ${b}`;
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
