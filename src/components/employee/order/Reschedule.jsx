"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ConfirmSend } from "@/components/employee/ConfirmSend";
import { SlotPicker } from "@/components/employee/SlotPicker";
import { TEMPLATES } from "@/domain/messages";
import { slotConflict } from "@/domain/booking";
import { fmtPhone, fmtApptTime } from "@/domain/format";
import { rescheduleOrderAction } from "@/app/employee/actions";

/**
 * The appointment: one line showing the booked time, opening into the mover.
 *
 * Its own verb rather than a couple of fields inside "Edit details", because
 * this is the single most common thing a customer phones about and burying it
 * is how it stayed impossible for so long.
 *
 * Collapsed to a single row (Jaime, 2026-08-13): the time is a fact glanced
 * at on every visit but moved on few, so the slot grid earns its screen only
 * when the row is opened. An order with no time yet opens expanded — there is
 * nothing to glance at and the next action is picking a slot. Collapsing
 * abandons an unsubmitted pick, exactly like "Keep current time", so a stale
 * half-made choice can never hide behind a closed row.
 *
 * Confirms like every other customer-facing send, previewing the exact text —
 * which for a reschedule is the point: you are about to tell somebody to be
 * home on a different day, and reading it back is the check that the slot you
 * tapped is the slot you meant.
 *
 * The slot picker IS the input (Jaime, 2026-08-13, replacing the date/time
 * boxes that used to sit above it): every booking shows as an occupied chip,
 * so only genuinely free times are tappable and this screen cannot start a
 * double-booking. The clash warning survives anyway — the
 * picker's data can be minutes stale, and the server re-checks regardless; the
 * override still rides the same confirmation, so agreeing to a double is
 * never implicit. The hidden fields carry the pick under stable names for
 * anything reading the DOM.
 */
export function Reschedule({
  shipment,
  busy,
  run,
  smsTestMode = false,
  officeLine = "",
  appointments = [],
  bookingSchedule,
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(!shipment.pickupDate);
  const [date, setDate] = useState(shipment.pickupDate || "");
  const [time, setTime] = useState(shipment.pickupTime || "");
  const [error, setError] = useState("");

  const changed = date && (date !== shipment.pickupDate || time !== (shipment.pickupTime || ""));
  // Excluding itself: an appointment may shuffle within its own slot.
  const clash = changed
    ? slotConflict(appointments, { pickupDate: date, pickupTime: time, excludeId: shipment.id })
    : null;
  // Rendered from the SAME template the action sends, against the new date, so
  // the preview is the message rather than an impression of it.
  const preview = shipment.phone
    ? TEMPLATES.pickup_rescheduled(
        { ...shipment, pickupDate: date, pickupTime: time },
        { officeLine },
      )
    : null;

  const booked = shipment.pickupDate
    ? `${shortDate(shipment.pickupDate)}${
        shipment.pickupTime ? ` · ${fmtApptTime(shipment.pickupTime)}` : ""
      }`
    : "No time set";

  function toggle() {
    if (expanded) {
      setDate(shipment.pickupDate || "");
      setTime(shipment.pickupTime || "");
    }
    setExpanded(!expanded);
  }

  function submit() {
    setError("");
    setOpen(false);
    // The clash was on screen in the dialog just confirmed, so the override is
    // informed — and the server refuses any clash this component didn't see.
    run(() =>
      rescheduleOrderAction(shipment.id, {
        pickupDate: date,
        pickupTime: time,
        confirmDoubleBook: Boolean(clash),
      }),
    );
  }

  return (
    <>
      <button
        type="button"
        data-appointment-toggle
        aria-expanded={expanded}
        onClick={toggle}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <CalendarClock size={17} className="shrink-0 text-accent" />
        <span className="flex-1 text-[15px] font-bold text-ink">{booked}</span>
        {!expanded && (
          <span className="text-[12.5px] text-muted">
            {shipment.pickupDate ? "Reschedule" : "Pick a time"}
          </span>
        )}
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-muted transition-transform", expanded && "rotate-180")}
        />
      </button>

      {/* Stable DOM carriers for the picked values; the grid writes them.
          Outside the fold on purpose — they exist whether or not the row is
          open, so nothing reading them has to know about the accordion. */}
      <input type="hidden" id="reschedule-date" name="rescheduleDate" value={date} />
      <input type="hidden" id="reschedule-time" name="rescheduleTime" value={time} />

      {expanded && (
        <div className="mt-3.5 border-t border-line/80 pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {changed ? (
              <>
                <span
                  data-reschedule-summary
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-l px-2.5 py-1.5 text-[13px] font-semibold text-accent"
                >
                  <CalendarClock size={14} />
                  {shortDate(date)}
                  {time ? ` · ${fmtApptTime(time)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDate(shipment.pickupDate || "");
                    setTime(shipment.pickupTime || "");
                  }}
                  className="text-[12px] font-semibold text-muted hover:text-ink"
                >
                  Keep current time
                </button>
              </>
            ) : (
              <span className="text-[13px] text-muted">Tap a free slot below to move it.</span>
            )}
            <Button
              variant="ghost"
              className="ml-auto"
              disabled={busy || !changed}
              onClick={() => (preview || clash ? setOpen(true) : submit())}
            >
              <CalendarClock size={15} /> Reschedule
            </Button>
          </div>
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}

          <div className="mt-3">
            <SlotPicker
              date={date}
              time={time}
              onPick={(picked) => {
                setDate(picked.date);
                setTime(picked.time);
              }}
              appointments={appointments}
              excludeId={shipment.id}
              schedule={bookingSchedule}
            />
          </div>

          {/* Lives inside the fold, at the moment someone is about to move a
              time — which is exactly when they'd otherwise "remind" a customer
              the machine already texted twice (lib/appointment-sweep.js). */}
          <p className="mt-2 text-[12px] text-muted">
            Reminders text automatically: the day before, the morning of, and about 30 minutes
            ahead.
          </p>
        </div>
      )}

      <ConfirmSend
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={submit}
        title="Move this appointment"
        confirmLabel={preview ? "Reschedule & text" : "Reschedule anyway"}
        message={preview}
        phone={fmtPhone(shipment.phone)}
        busy={busy}
        testMode={smsTestMode}
      >
        <p className="text-[13px] text-ink">
          Moving from{" "}
          <span className="font-semibold">
            {shipment.pickupDate || "unscheduled"}
            {shipment.pickupTime ? ` at ${fmtApptTime(shipment.pickupTime)}` : ""}
          </span>{" "}
          to{" "}
          <span className="font-semibold">
            {date}
            {time ? ` at ${fmtApptTime(time)}` : ""}
          </span>
          .
        </p>
        {clash && (
          <p className="mt-2 text-[13px] font-semibold text-status-awaiting">
            That slot already has {clash.name}&apos;s meetup. Confirming books both in the same 15
            minutes.
          </p>
        )}
      </ConfirmSend>
    </>
  );
}

/** "Fri, Aug 14" from a YYYY-MM-DD key; falls back to the raw key. */
function shortDate(key) {
  const [y, m, d] = String(key || "")
    .split("-")
    .map(Number);
  const parsed = y && m && d ? new Date(y, m - 1, d) : null;
  return parsed
    ? parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : key;
}
