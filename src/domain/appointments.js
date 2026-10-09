import { dayKey, addDays, timeRank, minutesInBusinessDay } from "./dates";
import {
  APPT_DAY_BEFORE_FROM_MINUTES,
  APPT_MORNING_FROM_MINUTES,
  APPT_SOON_WINDOW_MINUTES,
  APPT_MORNING_SKIP_WITHIN_MINUTES,
} from "./constants";

/**
 * The three automatic appointment reminders: the day before, the morning of,
 * and about 30 minutes ahead of the booked time.
 *
 * THIS USED TO BE A BUTTON, like the label reminders before it, and it went
 * the same way for the same reason: a reminder exists because somebody might
 * forget, and "somebody presses it at the right moment" is the exact failure
 * mode it is supposed to cover. The rules are pure and clock-injected so they
 * can be tested at any pretend hour; the sweep in lib/appointment-sweep.js
 * does the sending.
 *
 * EVERYTHING HERE RUNS ON CHARLOTTE'S CLOCK. Appointment dates and times are
 * local wall-clock values, the gates ("from 8am") are local promises, and the
 * server is UTC on Vercel — so every comparison goes through dayKey() and
 * minutesInBusinessDay(), both pinned to BUSINESS_TZ.
 */

/** In send order: the soonest-mattering lane first when several are due. */
export const APPT_LANES = ["soon", "morning_of", "day_before"];

const LANE_WORDS = {
  day_before: "day before",
  morning_of: "morning of",
  soon: "30 minutes before",
};

/**
 * The activity line that records one lane as sent — WITH the appointment
 * date baked in, which is what makes a reschedule re-arm all three lanes
 * without any clearing logic: the marker for the old date simply never
 * matches the new one. An activity line rather than three columns for the
 * usual reason — audit trail anyway, and no migration to hand-run.
 */
export function apptMarkerAction(lane, pickupDate) {
  return `Appointment reminder sent - ${LANE_WORDS[lane]} (${pickupDate})`;
}

/** Whether `lane` has already been sent for the CURRENT appointment date. */
export function apptReminderSent(order, lane) {
  if (!order?.pickupDate) return false;
  const marker = apptMarkerAction(lane, order.pickupDate);
  return (order?.activity || []).some((e) => e?.action === marker);
}

/**
 * Whether this order gets appointment reminders at all.
 *
 * Awaiting only — a received or paid handover already happened. A recorded
 * stop outcome means the visit was attempted; what happens next is the
 * failed-stop flow's business, not a cheery "see you at 2". PAUSE
 * (remindersCancelledAt) covers these like every other automated nudge.
 */
export function eligibleForApptReminders(order) {
  return Boolean(
    order?.type === "office" &&
    order?.status === "awaiting" &&
    order?.pickupDate &&
    order?.phone &&
    !order?.stopOutcome &&
    !order?.remindersCancelledAt,
  );
}

/**
 * Minutes until the booked time, on the business clock — or null when the
 * appointment has no parseable time (times are free text; timeRank sorts the
 * unparseable last, and here they simply have no "30 minutes before").
 */
export function minutesUntilAppointment(order, now = Date.now()) {
  const rank = timeRank(order?.pickupTime);
  if (rank === Number.MAX_SAFE_INTEGER) return null;
  return rank - minutesInBusinessDay(new Date(now));
}

/**
 * Which reminders this order is due RIGHT NOW, in send order.
 *
 * Gates are "from", not "at": each lane fires on the first sweep tick past
 * its time and the marker makes it once-only, so a sweep that was down for an
 * hour catches up instead of skipping the day. The morning lane defers to the
 * soon lane when the appointment is inside an hour — one message about one
 * visit per moment.
 */
export function dueApptLanes(order, now = Date.now()) {
  if (!eligibleForApptReminders(order)) return [];

  const at = new Date(now);
  const today = dayKey(at);
  const tomorrow = dayKey(addDays(at, 1));
  const nowMinutes = minutesInBusinessDay(at);
  const lanes = [];

  if (order.pickupDate === tomorrow) {
    if (nowMinutes >= APPT_DAY_BEFORE_FROM_MINUTES && !apptReminderSent(order, "day_before")) {
      lanes.push("day_before");
    }
    return lanes;
  }

  if (order.pickupDate !== today) return lanes;

  const until = minutesUntilAppointment(order, now);

  if (
    until !== null &&
    until > 0 &&
    until <= APPT_SOON_WINDOW_MINUTES &&
    !apptReminderSent(order, "soon")
  ) {
    lanes.push("soon");
  }

  if (
    nowMinutes >= APPT_MORNING_FROM_MINUTES &&
    // No booked time still gets the morning nudge; a booked time only gets it
    // while comfortably ahead — inside the hour the soon lane speaks instead,
    // and a time already gone by gets nothing but the failed-stop flow.
    (until === null || until > APPT_MORNING_SKIP_WITHIN_MINUTES) &&
    !apptReminderSent(order, "morning_of")
  ) {
    lanes.push("morning_of");
  }

  return lanes;
}
