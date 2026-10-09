import { sendSms } from "@/lib/twilio/client";
import { activeStaffRecipients } from "@/lib/repositories/profiles";
import {
  newAppointmentAlertText,
  rescheduledAppointmentAlertText,
  appointmentEndedAlertText,
} from "@/domain/appointment-alert";
import { normPhone } from "@/domain/format";

/**
 * Tell the team whenever an appointment on the calendar changes - booked,
 * moved, cancelled, or a failed visit reported. One shared sender behind the
 * three events below (see domain/appointment-alert.js for the copy).
 *
 * Same reasoning as lib/inbound-notify.js for an inbound text: NOT
 * sendAndLog, deliberately - this is a staff alert, not a customer
 * conversation, and filing it into a message thread would corrupt the
 * record of what we actually said to the customer.
 *
 * BEST EFFORT, NEVER THROWS. Every caller runs this after the order change is
 * already saved - a booking, reschedule, or cancellation must never fail
 * because an alert could not send.
 *
 * Skips whoever just made the change: being told about the thing you just
 * did yourself is noise, not news.
 */
async function sendStaffAlert(text, excludeStaffId) {
  try {
    const recipients = await activeStaffRecipients();
    const results = await Promise.allSettled(
      recipients
        .filter((r) => r.id !== excludeStaffId)
        .map((r) => normPhone(r.phone || ""))
        .filter((digits) => digits.length === 10)
        .map((digits) => sendSms({ to: `+1${digits}`, body: text })),
    );

    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r) => String(r.reason?.message || r.reason));
    if (failed.length) console.error("Staff appointment alert send failures:", failed);
  } catch (err) {
    console.error("Staff appointment alert failed:", err?.message || err);
  }
}

/** @param {{name: string, pickupDate: string, pickupTime: string}} order @param {{id: string}} [staff] */
export async function notifyTeamOfNewAppointment(order, staff) {
  await sendStaffAlert(newAppointmentAlertText(order), staff?.id);
}

/** @param {string} was the appointment's previous date/time, already formatted for a human. */
export async function notifyTeamOfReschedule(order, was, staff) {
  await sendStaffAlert(rescheduledAppointmentAlertText(order, was), staff?.id);
}

/** @param {string} headline e.g. "Appointment cancelled", "Didn't show up", "Appointment deleted". */
export async function notifyTeamOfAppointmentEnded(headline, order, staff) {
  await sendStaffAlert(appointmentEndedAlertText(headline, order), staff?.id);
}
