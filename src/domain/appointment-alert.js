import { fmtApptTime } from "./format";
import { formatPickupDate } from "./messages";

/**
 * The texts team members get whenever an appointment changes on the
 * calendar - booked, moved, cancelled, or reported as a failed visit. One
 * function per event so each reads like the specific thing that happened
 * rather than a generic "order updated".
 *
 * Deliberately the ONLY staff alert left (Jaime, 2026-10-03) - a per-text
 * "customer texted in" alert used to exist too and got pulled because every
 * reply in an ongoing conversation re-fired it, which read as spam to
 * everyone on the team. Appointment changes are rare enough per order that
 * firing every time is the right call; inbound texts are not.
 *
 * STAFF-FACING BUT BILLED LIKE ANY OTHER SMS, so this file is on the
 * check-sms-encoding list and stays ASCII: one em dash here would re-encode
 * every alert as UCS-2 at double the cost.
 */

function whenText(pickupDate, pickupTime) {
  return [formatPickupDate(pickupDate), fmtApptTime(pickupTime)].filter(Boolean).join(" at ");
}

function nameOrFallback(name) {
  return String(name || "").trim() || "A customer";
}

export function newAppointmentAlertText({ name, pickupDate, pickupTime }) {
  const who = nameOrFallback(name);
  const when = whenText(pickupDate, pickupTime);
  if (!when) return `New appointment booked: ${who} (no time set)`;
  return `New appointment: ${who} - ${when}`;
}

/** @param {string} was the previous date/time, already formatted for a human ("" when it had none). */
export function rescheduledAppointmentAlertText({ name, pickupDate, pickupTime }, was) {
  const who = nameOrFallback(name);
  const now = whenText(pickupDate, pickupTime) || "no time set";
  return `Appointment moved: ${who} - now ${now} (was ${was || "unscheduled"})`;
}

/** Shared shape for an appointment that is no longer happening as planned: cancelled, deleted, or a failed visit. */
export function appointmentEndedAlertText(headline, { name, pickupDate, pickupTime }) {
  const who = nameOrFallback(name);
  const when = whenText(pickupDate, pickupTime);
  return when ? `${headline}: ${who} - ${when}` : `${headline}: ${who}`;
}
