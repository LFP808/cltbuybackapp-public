import { dayKey, addDays } from "@/domain/dates";
import { dueApptLanes, apptMarkerAction } from "@/domain/appointments";
import { TEMPLATES } from "@/domain/messages";
import { isMessagingEnabled } from "@/domain/mode";
import { sendAndLog } from "@/lib/messaging";
import { officeAddressLine } from "@/lib/business";
import { listAppointmentCandidates, patchOrderAsSystem } from "@/lib/repositories/reminders";

/**
 * The appointment reminders: day before, morning of, ~30 minutes ahead.
 *
 * Runs every 15 minutes (vercel.json), and that frequency is the design:
 * "8am Eastern" and "30 minutes before a 2pm meetup" are LOCAL promises a
 * fixed UTC cron hour cannot keep across DST, so the schedule lives in
 * domain/appointments.js as business-clock gates and this sweep just ticks.
 * Most ticks send nothing — each lane is once-only via an activity marker
 * that read back in dueApptLanes(), written only after the text really went.
 *
 * Same shape as reminder-sweep on purpose: sequential sends, per-order error
 * containment, a dry mode that names names.
 */

const LANE_TEMPLATES = {
  day_before: TEMPLATES.appt_day_before,
  morning_of: TEMPLATES.appt_morning_of,
  soon: TEMPLATES.appt_soon,
};

export async function runAppointmentSweep({ dry = false, limit = 500 } = {}) {
  const now = Date.now();
  const result = {
    sent: { day_before: 0, morning_of: 0, soon: 0 },
    skipped: 0,
    failed: 0,
    candidates: 0,
    truncated: false,
    reasons: [],
    would: { day_before: [], morning_of: [], soon: [] },
  };

  const at = new Date(now);
  const days = [dayKey(at), dayKey(addDays(at, 1))];
  const candidates = await listAppointmentCandidates(days, limit);
  result.candidates = candidates.length;
  result.truncated = candidates.length === limit;

  // system: no session here, and the address is an admin SETTING behind RLS
  // — a session read would silently fall back to env (see getSetting).
  const officeLine = await officeAddressLine({ system: true });

  for (const order of candidates) {
    try {
      const lanes = dueApptLanes(order, now);
      if (!lanes.length) {
        result.skipped += 1;
        continue;
      }

      // `activity` accumulates across lanes so two markers written in one
      // tick (rare: a morning lane and a soon lane both overdue after an
      // outage) don't overwrite each other.
      let activity = order.activity || [];
      for (const lane of lanes) {
        if (dry) {
          result.would[lane].push(order.name);
          result.sent[lane] += 1;
          continue;
        }

        await sendAndLog({
          phone: order.phone,
          orderId: order.id,
          body: LANE_TEMPLATES[lane](order, { officeLine }),
          auto: true,
          sentBy: "Automatic reminder",
          system: true,
        });

        // Marker AFTER the send, the same rule as every once-only text: a
        // reminder nobody received must not use up its once. Guarded on
        // `awaiting`, so an order that advanced mid-tick keeps its history.
        activity = [
          ...activity,
          {
            action: apptMarkerAction(lane, order.pickupDate),
            by: "Automatic reminder",
            at: Date.now(),
          },
        ];
        const ok = await patchOrderAsSystem(order.id, { activity }, "awaiting");
        if (!ok) {
          result.reasons.push(
            `${order.name}: advanced mid-sweep - later reminders left to the new status`,
          );
          break;
        }
        result.sent[lane] += 1;
      }
    } catch (err) {
      // One bad number must not abandon the rest of the tick.
      console.error(`Appointment sweep failed on order ${order.id}:`, err?.message || err);
      result.failed += 1;
    }
  }

  return result;
}

/** Whether the sweep can run at all — same rule as the CRM sweep. */
export function appointmentSweepBlockedReason() {
  return isMessagingEnabled() ? null : "messaging is switched off";
}
