"use client";

import { Card } from "@/components/ui";
import { SlotPicker } from "@/components/employee/SlotPicker";
import { parseLocalDate } from "@/domain/dates";
import { fmtApptTime } from "@/domain/format";

/**
 * When: the booking card for a meetup — the /new form's right column.
 *
 * Rendered by the form only when the visit is still ahead (a walk-in already
 * happened), so it never has to ask. State stays in the form (submit folds
 * `pickup` into the payload); this owns only the presentation, on the exact
 * (pickup, setPickup) seam.
 *
 * The picker IS the input (Jaime, 2026-08-13, superseding the two native
 * date/time boxes): pick a day on the strip, pick a time chip, and both
 * fields are written in one motion — the old inputs were a second, competing
 * way to answer the same question, and how odd colliding times got typed.
 * The hidden fields below carry the chosen values under stable names for
 * anything reading the DOM (tests, autofill); the picker is the only thing
 * that writes them. The chosen slot is echoed in the form's summary/actions
 * card, next to the Create button.
 */
export function MeetupSchedule({ pickup, setPickup, officeLine, appointments, bookingSchedule }) {
  return (
    <Card className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Pick a time</h3>
        {/* The form collects no address, so say where the customer is actually
            coming - staff read this out on the call. Renders without the
            address until the env provides one. */}
        <p className="mt-0.5 text-[12.5px] text-muted">
          {officeLine ? `Meetup at our office - ${officeLine}.` : "Meetup at our office."}
        </p>
      </div>

      {/* The submit path reads React state, but the values still live in the
          DOM under their old names so nothing outside React loses the seam. */}
      <input type="hidden" id="pickupDate" name="pickupDate" value={pickup.pickupDate} />
      <input type="hidden" id="pickupTime" name="pickupTime" value={pickup.pickupTime} />

      <SlotPicker
        date={pickup.pickupDate}
        time={pickup.pickupTime}
        onPick={({ date, time }) =>
          setPickup((p) => ({ ...p, pickupDate: date, pickupTime: time }))
        }
        appointments={appointments}
        schedule={bookingSchedule}
      />
    </Card>
  );
}

/**
 * "Fri, Aug 14 · 10:15 AM" — or just the day while the time is still open,
 * or null when nothing is chosen yet. A time with no date is unbookable and
 * summarizes as nothing rather than as a floating clock reading. Used by the
 * form's summary/actions card, exported from here so the format lives beside
 * the card that creates the value.
 */
export function pickupSummary({ pickupDate, pickupTime }) {
  const date = parseLocalDate(pickupDate);
  if (!date) return null;
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return pickupTime ? `${day} · ${fmtApptTime(pickupTime)}` : day;
}
