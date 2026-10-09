// Explicit .js extensions so plain Node can load this module too (qa-flows
// spot-checks the suggestion helpers without a bundler); Next resolves the
// extension either way.
import {
  timeRank,
  parseLocalDate,
  mondayIndex,
  dayKey,
  addDaysToKey,
  formatKey,
  minutesInBusinessDay,
} from "./dates.js";
import { fmtApptTime } from "./format.js";

/**
 * The 15-minute appointment grid (Jaime, 2026-08-12): meetups and pickups are
 * booked on quarter-hour slots so two customers are never told the same time.
 *
 * Pure logic only — which slot a time falls in, which slots a day has, and
 * whether a proposed appointment collides with an existing one. The picker
 * renders these answers and the server actions enforce them, so the form and
 * the action can never disagree about what "taken" means.
 *
 * Times are still stored as free text ("14:00" from the picker, but "2pm"
 * typed by hand years ago survives). Anything unparseable has NO slot: it
 * cannot collide, and the picker lists it beside the grid instead of hiding
 * it — an invisible appointment is how double-booking happens.
 */
export const APPT_SLOT_MINUTES = 15;

/**
 * The DEFAULT bookable day, in minutes since midnight: 8:00 AM up to (not
 * including) 8:00 PM, so the last offered slot is 7:45 PM. Wide on purpose —
 * better to offer evenings nobody books than to make a 7pm meetup impossible —
 * and a slot outside the window can still be typed into the time field.
 */
export const BOOKING_DAY_START_MIN = 8 * 60;
export const BOOKING_DAY_END_MIN = 20 * 60;
export const DEFAULT_BOOKING_HOURS = {
  startMin: BOOKING_DAY_START_MIN,
  endMin: BOOKING_DAY_END_MIN,
};

/**
 * THE SCHEDULE (Jaime, 2026-08-13, superseding the one-window-for-every-day
 * setting): hours per weekday, plus overrides for specific dates.
 *
 * Stored in app_settings under booking_hours as
 *
 *   { "week":  { "mon": {"start":"08:00","end":"20:00"}, ..., "sun": null },
 *     "dates": { "2026-11-26": null,
 *                "2026-12-24": {"start":"08:00","end":"12:00"} } }
 *
 * null means CLOSED — no slots offered that day. A date override beats the
 * weekday. The pre-schedule flat shape ({start, end}) still normalizes (it
 * becomes that window every day), because a value saved last week must not
 * turn into surprise defaults this week.
 *
 * Normalized runtime shape: `week` is a 7-element array, MONDAY FIRST like
 * every other week boundary in the app; entries and date values are
 * {startMin, endMin} windows or null.
 */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DEFAULT_BOOKING_SCHEDULE = {
  week: WEEKDAY_KEYS.map(() => ({ ...DEFAULT_BOOKING_HOURS })),
  dates: {},
};

/**
 * One stored window as validated minutes, or null when it is unparseable,
 * inverted or degenerate. THE PAIR FAILS TOGETHER: patching one bad half
 * against a default invents a window nobody chose. Times snap DOWN to the
 * 15-minute grid, matching slotOf — an "08:10" start offers the 8:00 slot
 * rather than silently hiding it.
 */
export function parseWindow(raw) {
  const start = timeRank(raw?.start);
  const end = timeRank(raw?.end);
  if (start === Number.MAX_SAFE_INTEGER || end === Number.MAX_SAFE_INTEGER) return null;
  const startMin = Math.floor(start / APPT_SLOT_MINUTES) * APPT_SLOT_MINUTES;
  const endMin = Math.floor(end / APPT_SLOT_MINUTES) * APPT_SLOT_MINUTES;
  if (startMin < 0 || endMin > 24 * 60 || startMin >= endMin) return null;
  return { startMin, endMin };
}

/**
 * The stored booking_hours value as a normalized schedule. Every unusable
 * piece falls back on its own: a broken weekday gets the default window (a
 * day must never silently close because of a typo in a row nobody can see),
 * while a broken DATE override is dropped (falling back to the weekday is
 * exactly what "no override" means).
 */
export function normalizeBookingSchedule(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      week: DEFAULT_BOOKING_SCHEDULE.week.map((w) => ({ ...w })),
      dates: {},
    };
  }
  // The pre-schedule flat shape: one window, every day.
  if (!raw.week && !raw.dates) {
    const window = parseWindow(raw) ?? DEFAULT_BOOKING_HOURS;
    return { week: WEEKDAY_KEYS.map(() => ({ ...window })), dates: {} };
  }

  const week = WEEKDAY_KEYS.map((key) => {
    const value = raw.week?.[key];
    if (value === null) return null; // closed on purpose
    return parseWindow(value) ?? { ...DEFAULT_BOOKING_HOURS };
  });

  const dates = {};
  for (const [key, value] of Object.entries(raw.dates ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    if (value === null) {
      dates[key] = null;
      continue;
    }
    const window = parseWindow(value);
    if (window) dates[key] = window;
  }

  return { week, dates };
}

/**
 * The bookable window for one calendar day — the date override when there is
 * one, else the weekday's hours. null means closed. This is THE lookup: the
 * grid, the settings preview and anything else asking "can that day take a
 * booking" must all go through it.
 *
 * @param {ReturnType<typeof normalizeBookingSchedule>} schedule
 * @param {string} day YYYY-MM-DD
 * @returns {{startMin: number, endMin: number} | null}
 */
export function hoursForDay(schedule, day) {
  if (Object.prototype.hasOwnProperty.call(schedule?.dates ?? {}, day)) {
    return schedule.dates[day];
  }
  const date = parseLocalDate(day);
  if (!date) return null;
  return schedule?.week?.[mondayIndex(date)] ?? null;
}

/**
 * The single row-range that can display every open window among `days` — the
 * week grid's vertical extent. Days outside their own window render as
 * closed cells inside this union. null when every day is closed.
 */
export function gridWindow(schedule, days) {
  let startMin = Infinity;
  let endMin = -Infinity;
  for (const day of days) {
    const w = hoursForDay(schedule, day);
    if (!w) continue;
    startMin = Math.min(startMin, w.startMin);
    endMin = Math.max(endMin, w.endMin);
  }
  return startMin < endMin ? { startMin, endMin } : null;
}

/**
 * The picker's ROLLING seven-day window (Jaime, 2026-08-13): booking always
 * starts from TODAY, never from a Monday — a Thursday grid that opens with
 * three dead Mon–Wed columns is width nobody can ever book. Clamped so the
 * window can never start in the past, which is also what makes the picker's
 * back button safe to wire straight to "shift 7 days earlier". The /calendar
 * views keep their Monday-first weeks — history is their job, not this one's.
 *
 * "TODAY" AND EVERY DAY IN THE WINDOW ARE BUSINESS-TZ CALENDAR DAYS, not the
 * viewer's. This runs client-side in the picker, so "the viewer" is whatever
 * timezone a staffer's or the remote VA's OWN device is set to — stepping by
 * `new Date(y, m, d + n)` would build each day at THEIR local midnight, and
 * re-labelling that with dayKey() can land it on the wrong side of the
 * Eastern day boundary (Saturday's column silently reading Sunday's hours).
 * Everything here is therefore key-string arithmetic (addDaysToKey) until the
 * very last step, where a Date is built ONLY for display formatting (weekday
 * name, day-of-month) — never fed back through dayKey.
 *
 * Same {key, date, isToday} cell shape as calendar-events' weekDays, so
 * weekLabel and the grid render code work on either.
 *
 * @param {Date|string} start requested first day (a Date, or a YYYY-MM-DD
 *   business-day key already); anything before today clamps to today
 * @param {Date} [today] injectable for tests
 * @returns {Array<{key: string, date: Date, isToday: boolean}>}
 */
export function bookingWindow(start, today = new Date()) {
  const todayK = dayKey(today);
  const startK =
    typeof start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start)
      ? start
      : start instanceof Date && !Number.isNaN(start.getTime())
        ? dayKey(start)
        : todayK;
  const baseK = startK < todayK ? todayK : startK; // YYYY-MM-DD strings compare chronologically
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(baseK, i);
    return { key, date: parseLocalDate(key), isToday: key === todayK };
  });
}

/**
 * The slot a free-text time falls in, in minutes since midnight, or null when
 * the time is missing/unparseable. 2:07 PM belongs to the 2:00 slot: slots are
 * buckets, not exact matches, so "14:00" and "14:10" collide rather than
 * sitting invisibly side by side.
 */
export function slotOf(pickupTime) {
  const rank = timeRank(pickupTime);
  if (rank === Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(rank / APPT_SLOT_MINUTES) * APPT_SLOT_MINUTES;
}

/** Minutes since midnight -> the "HH:MM" value a time input (and the DB) holds. */
export function slotValue(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutes since midnight -> "2:15 PM", via the one formatter every surface uses. */
export function slotLabel(min) {
  return fmtApptTime(slotValue(min));
}

/**
 * The last bookable slot of a day sits this far BEFORE closing. Zeroed out
 * (Jaime, 2026-10-04) — overrides the original 30-minute buffer (a buy takes
 * real time to honor against a hard close) so the grid offers slots through
 * the closing hour itself; close at 2:00 PM now offers 2:00 PM last.
 */
export const LAST_SLOT_BUFFER_MINUTES = 0;

/**
 * Whether a slot may be OFFERED inside a day window: on the grid, at or
 * after opening, and finished with room to spare before closing (the
 * LAST_SLOT_BUFFER_MINUTES rule). This predicate is shared by slotGrid and
 * by the picker's "does this existing booking get a chip" placement, so a
 * legacy booking inside the buffer falls to the visible off-grid list
 * instead of silently losing its cell.
 *
 * @param {{startMin: number, endMin: number} | null} w a normalized window
 * @param {number} min minutes since midnight
 */
export function bookableWithin(w, min) {
  return Boolean(w) && min >= w.startMin && min + LAST_SLOT_BUFFER_MINUTES <= w.endMin;
}

/**
 * The day's slot grid, grouped by hour for rendering: one row per hour, up to
 * four quarter-hour slots each. A window that starts or ends mid-hour keeps
 * its hour row with only the slots inside the window, and the final
 * LAST_SLOT_BUFFER_MINUTES before closing offer nothing — every surface
 * that says "this time is available" (the chip grid, the copy-times offers)
 * reads this one generator, so the buffer holds everywhere by construction.
 *
 * @param {{startMin: number, endMin: number}} [hours] a normalized window
 * @returns {Array<{hour: number, label: string, slots: Array<{min: number, value: string, label: string}>}>}
 */
export function slotGrid(hours = DEFAULT_BOOKING_HOURS) {
  const rows = [];
  for (let h = Math.floor(hours.startMin / 60); h * 60 < hours.endMin; h++) {
    const slots = [0, 15, 30, 45]
      .map((q) => h * 60 + q)
      .filter((min) => bookableWithin(hours, min))
      .map((min) => ({ min, value: slotValue(min), label: slotLabel(min) }));
    if (slots.length) rows.push({ hour: h, label: fmtApptTime(slotValue(h * 60)), slots });
  }
  return rows;
}

/**
 * Whether this order occupies calendar time: an in-person kind that is still
 * going to happen. Same terminal states the calendar drops — a cancelled or
 * finished visit blocks nothing.
 */
export function isActiveAppointment(order) {
  return order?.type === "office" && order?.status !== "cancelled" && order?.status !== "paid";
}

/**
 * Everything already booked on `day`, time-sorted — what the picker shows so
 * the person booking sees the whole day, not just a refused submit.
 */
export function dayBookings(appointments = [], day, excludeId = null) {
  if (!day) return [];
  return appointments
    .filter((a) => a.pickupDate === day && a.id !== excludeId && isActiveAppointment(a))
    .sort((a, b) => timeRank(a.pickupTime) - timeRank(b.pickupTime));
}

/**
 * Open slots worth OFFERING a lead, ready for suggestionText: starting at
 * `from` (clamped to today), the next `days` days that have availability,
 * with up to `perDay` open times each — spread across the free set (first /
 * middle / last), because offering 1:00, 1:15 and 1:30 reads as one option
 * written three times. Availability means exactly what the picker renders:
 * inside that day's hours, not already booked, not earlier than now.
 *
 * @param {{
 *   appointments?: Array<object>,
 *   schedule?: ReturnType<typeof normalizeBookingSchedule>,
 *   from?: Date|string,
 *   days?: number,
 *   perDay?: number,
 *   excludeId?: string|null,
 *   now?: Date,
 * }} opts `from` is a YYYY-MM-DD business-day key, or a Date read as the
 *   business-TZ calendar day it falls in; `now` is injectable for tests.
 * @returns {Array<{date: string, times: string[]}>} times as "HH:MM" values
 */
export function openSlotSuggestions({
  appointments = [],
  schedule = DEFAULT_BOOKING_SCHEDULE,
  from = new Date(),
  days = 2,
  perDay = 3,
  excludeId = null,
  now = new Date(),
} = {}) {
  // BUSINESS-TZ "today" and "now", never the caller's own clock. This runs
  // in the picker (the remote VA's browser) and can run on a UTC server, and
  // the slots it filters are Charlotte wall-clock times. The old
  // `now.getHours()` read the VIEWER's wall clock instead: on Asia/Manila,
  // 12 hours ahead of Eastern, every one of today's slots was "already gone"
  // from mid-morning Charlotte time, so the VA had nothing to offer for
  // today (2026-10-06). The day cursor had the sibling bug — stepping a
  // viewer-local Date and re-labelling it with dayKey() rolled the start day
  // back by one from Manila (the trap bookingWindow's header describes) —
  // so the walk is key-string arithmetic, like bookingWindow's.
  const todayK = dayKey(now);
  const nowMin = minutesInBusinessDay(now);
  const fromK =
    typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from)
      ? from
      : from instanceof Date && !Number.isNaN(from.getTime())
        ? dayKey(from)
        : todayK;
  const baseK = fromK < todayK ? todayK : fromK; // YYYY-MM-DD strings compare chronologically

  const out = [];
  // Bounded scan: two weeks of closed days means there is nothing to offer,
  // and a text listing times a month out would read as a brush-off anyway.
  for (let step = 0; step < 14 && out.length < days; step++) {
    const day = addDaysToKey(baseK, step);
    const w = hoursForDay(schedule, day);
    if (!w) continue;
    const bookedSlots = new Set(
      dayBookings(appointments, day, excludeId)
        .map((a) => slotOf(a.pickupTime))
        .filter((min) => min !== null),
    );
    const free = slotGrid(w)
      .flatMap((row) => row.slots)
      .filter((s) => !bookedSlots.has(s.min) && !(day === todayK && s.min < nowMin));
    if (free.length === 0) continue;
    out.push({ date: day, times: spacedPicks(free, perDay).map((s) => s.value) });
  }
  return out;
}

/** Up to n entries spread evenly across the list, always keeping the ends. */
function spacedPicks(list, n) {
  if (list.length <= n) return list;
  const picks = [];
  for (let i = 0; i < n; i++) {
    picks.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  }
  return [...new Set(picks)];
}

/**
 * openSlotSuggestions as the one-line text a lead actually receives:
 *
 *   "We have 1:00 PM, 2:00 PM or 3:00 PM on Monday, and 2:15 PM or 3:30 PM
 *    on Tuesday - what time/day works for you?"
 *
 * A single-day offer drops the "/day" — "what time works for you?" — because
 * the day is not a question the text just asked.
 *
 * STRICTLY GSM-7: plain hyphen, straight punctuation — this string's whole
 * job is being pasted into an SMS, where one curly character silently
 * re-encodes the message as UCS-2 and doubles the bill.
 */
export function suggestionText(suggestions = []) {
  const parts = suggestions
    .filter((s) => s.times.length > 0)
    .map((s) => {
      const labels = s.times.map((t) => fmtApptTime(t));
      const list =
        labels.length === 1
          ? labels[0]
          : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
      // formatKey, not parseLocalDate + an explicit timeZone - this text
      // gets copy-pasted straight into an SMS sent from a UTC server, and
      // that combination is what used to roll the weekday back a day (see
      // domain/dates.js#formatKey).
      const weekday = formatKey(s.date, { weekday: "long" });
      return `${list} on ${weekday}`;
    });
  if (parts.length === 0) return "";
  const ask = parts.length === 1 ? "what time works for you?" : "what time/day works for you?";
  return `We have ${parts.join(", and ")} - ${ask}`;
}

/**
 * The existing appointment a proposed one collides with, or null.
 *
 * A collision is the SAME 15-MINUTE SLOT on the same day, across both
 * in-person kinds: one team runs the office and the van, so a meetup and a
 * pickup at 2:15 are still two places to be at once. No date or no parseable
 * time means nothing to collide with — an untimed booking is a promise for
 * the day, not a slot.
 *
 * @param {Array<object>} appointments same-day or broader; filtered here
 * @param {{pickupDate?: string, pickupTime?: string, excludeId?: string|null}} proposed
 */
export function slotConflict(appointments = [], { pickupDate, pickupTime, excludeId = null }) {
  const slot = slotOf(pickupTime);
  if (!pickupDate || slot === null) return null;
  return (
    dayBookings(appointments, pickupDate, excludeId).find((a) => slotOf(a.pickupTime) === slot) ||
    null
  );
}
