"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import {
  slotGrid,
  slotOf,
  dayBookings,
  isActiveAppointment,
  hoursForDay,
  bookableWithin,
  bookingWindow,
  openSlotSuggestions,
  suggestionText,
  DEFAULT_BOOKING_SCHEDULE,
} from "@/domain/booking";
import { weekLabel } from "@/domain/calendar-events";
import { dayKey, addDaysToKey, formatKey, minutesInBusinessDay } from "@/domain/dates";
import { fmtApptTime } from "@/domain/format";
import { Toast } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * The booking input: a rolling 7-day strip starting TODAY, then the chosen
 * day's times as readable chips (Jaime, 2026-08-13, third shape of this
 * control — superseding the 7-column × 15-minute wall, whose mostly-empty
 * cells buried the few facts that matter under a page of dead borders).
 *
 * Two taps book: pick a day on the strip, pick a time chip — and this IS the
 * only input; onPick writes the consumer's hidden date/time fields. What the
 * chips say is the whole state of the day: a free time reads as a time, a
 * BOOKED time stays visible as a disabled chip wearing the customer's first
 * name (a slot that silently vanished is how double-booking happens), and a
 * time already gone today is omitted — it isn't bookable, so it isn't
 * offered. Days the schedule closes say "Closed" on the strip itself.
 *
 * The strip can never show yesterday (bookingWindow clamps to today; the
 * back chevron disables at the start), because nothing in the past is
 * bookable and dead columns are width the eye must climb over.
 *
 * WHAT MUST NEVER BE INVISIBLE: an appointment whose free-text time doesn't
 * parse ("around noon"), or one outside its day's hours — including on a day
 * marked closed. It gets no chip, so it is listed under the grid instead.
 * Same domain functions as the server's double-book check (slotOf,
 * hoursForDay, dayBookings), so the picker and the refusal cannot disagree.
 */
export function SlotPicker({
  date,
  time,
  onPick,
  appointments = [],
  excludeId = null,
  schedule = DEFAULT_BOOKING_SCHEDULE,
}) {
  // Anchor the window on the chosen date when there is one; bookingWindow
  // clamps anything in the past to today, so the anchor never needs guarding.
  // A business-day KEY, not a Date — see bookingWindow's header for why a
  // bare Date here would drift a day off in a viewer whose device clock
  // isn't set to Eastern.
  const [anchor, setAnchor] = useState(() => date || dayKey(new Date()));
  const days = useMemo(() => bookingWindow(anchor), [anchor]);

  // Which day's chips are on show. A plain string so paging weeks doesn't
  // fight it: when the viewed day scrolls out of the window, fall back to
  // the window's first day rather than chasing it with an effect.
  const [viewed, setViewed] = useState(() => date || days[0].key);
  const shownDay = days.some((d) => d.key === viewed) ? viewed : days[0].key;

  // "Today" AND "now" on the BUSINESS clock. dayKey was already pinned to
  // Charlotte, but nowMin read the viewer's own getHours() — and this runs
  // in the remote VA's browser. On Asia/Manila (12 hours ahead of Eastern)
  // every slot in today's column was "already gone" from mid-morning
  // Charlotte time, so the VA saw "Nothing left today" while the admin, on
  // an Eastern device, saw the whole day (2026-10-06). minutesInBusinessDay
  // is the same clock the appointment sweep gates on.
  const todayKey = dayKey(new Date());
  const nowMin = minutesInBusinessDay(new Date());
  const selectedSlot = slotOf(time);

  // day -> slot -> the appointment holding it; plus everything unplaceable.
  // "Placeable" is judged against the DAY'S OWN window: a booking at 3 PM on
  // a 10-2 Saturday has no chip even though other days offer 3 PM.
  const { taken, offGrid } = useMemo(() => {
    const takenMap = new Map();
    const off = [];
    const visible = new Set(days.map((d) => d.key));
    for (const a of appointments) {
      if (!isActiveAppointment(a) || a.id === excludeId || !visible.has(a.pickupDate)) continue;
      const slot = slotOf(a.pickupTime);
      const w = hoursForDay(schedule, a.pickupDate);
      // Same predicate slotGrid renders by (incl. the before-closing
      // buffer) — a booking with no chip must fall to the off-grid list,
      // never vanish.
      if (slot === null || !bookableWithin(w, slot)) {
        off.push(a);
        continue;
      }
      if (!takenMap.has(a.pickupDate)) takenMap.set(a.pickupDate, new Map());
      const byMin = takenMap.get(a.pickupDate);
      if (!byMin.has(slot)) byMin.set(slot, a);
    }
    off.sort((x, y) => x.pickupDate.localeCompare(y.pickupDate));
    return { taken: takenMap, offGrid: off };
  }, [appointments, days, schedule, excludeId]);

  // The shown day's offerable slots: its own hours, minus times already gone
  // today. Booked ones stay in — they render as occupied, not as absent.
  const shownSlots = useMemo(() => {
    const w = hoursForDay(schedule, shownDay);
    if (!w) return null; // closed
    return slotGrid(w)
      .flatMap((row) => row.slots)
      .filter((s) => !(shownDay === todayKey && s.min < nowMin));
  }, [schedule, shownDay, todayKey, nowMin]);

  const clash =
    date && selectedSlot !== null
      ? dayBookings(appointments, date, excludeId).find(
          (a) => slotOf(a.pickupTime) === selectedSlot,
        )
      : null;

  const atToday = Boolean(days[0]?.isToday);

  // The ready-to-paste "here's when we're free" texts for a lead, built from
  // the SAME availability the chips render (pure helpers in domain/booking),
  // starting at the day being viewed. Empty string = nothing to offer.
  // Two scopes, one code path: the next two open days, and the shown day
  // alone (days:1 scans forward, so filter pins it — a day-scoped offer must
  // never quietly slide to tomorrow).
  const offerText = useMemo(
    () =>
      suggestionText(
        openSlotSuggestions({
          appointments,
          schedule,
          from: shownDay,
          excludeId,
        }),
      ),
    [appointments, schedule, shownDay, excludeId],
  );
  const dayOfferText = useMemo(
    () =>
      suggestionText(
        openSlotSuggestions({
          appointments,
          schedule,
          from: shownDay,
          days: 1,
          excludeId,
        }).filter((s) => s.date === shownDay),
      ),
    [appointments, schedule, shownDay, excludeId],
  );
  // formatKey, not parseLocalDate + an explicit timeZone - that combination
  // construct-in-the-VIEWER's-own-clock, read-in-Eastern only agrees when
  // the viewer's device happens to already be set to Eastern. A VA on
  // Asia/Manila saw today's own column labelled with YESTERDAY's weekday
  // (2026-10-03). See domain/dates.js#formatKey.
  const shownWeekday = formatKey(shownDay, { weekday: "long" }) || shownDay;
  // Success confirms via the snackbar; only FAILURE lives on the button
  // (transient, like the export buttons), because a failure toast titled
  // "Copied" would be the one thing worse than silence.
  const [copyFailed, setCopyFailed] = useState(false);
  const failTimer = useRef(null);
  // The toast shows the string that actually hit the clipboard, captured at
  // copy time — offerText keeps recomputing as bookings change, and a popup
  // that differs from the clipboard is lying. copies also keys the toast so
  // a repeat press restarts its clock.
  const [copiedText, setCopiedText] = useState("");
  const [copies, setCopies] = useState(0);
  const [toastOpen, setToastOpen] = useState(false);
  function copyOffer(text) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedText(text);
        setCopies((c) => c + 1);
        setToastOpen(true);
      },
      () => {
        setCopyFailed(true);
        clearTimeout(failTimer.current);
        failTimer.current = setTimeout(() => setCopyFailed(false), 2000);
      },
    );
  }

  return (
    <div>
      {/* Chrome shared with the /calendar views: chevrons + span label.
          Paging steps from the DISPLAYED first day, not the raw anchor, so a
          clamped anchor can't make "later" jump somewhere unexpected. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAnchor(addDaysToKey(days[0].key, -7))}
          disabled={atToday}
          aria-label="Earlier days"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-0 font-serif text-[15px] text-ink">{weekLabel(days)}</span>
        <button
          type="button"
          onClick={() => setAnchor(addDaysToKey(days[0].key, 7))}
          aria-label="Later days"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
        {!atToday && (
          <button
            type="button"
            onClick={() => setAnchor(dayKey(new Date()))}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-accent hover:text-accent"
          >
            Today
          </button>
        )}
        {/* Ready-to-send offers for the clipboard, pasted straight into the
            lead's SMS thread: the shown day alone, or the next two open
            days. Failure flips the pair red; success confirms by toast. */}
        <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => copyOffer(dayOfferText)}
            disabled={!dayOfferText}
            title={
              dayOfferText
                ? `Copy a text offering open times on ${shownWeekday}`
                : `Nothing open on ${shownWeekday} to offer`
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold transition-colors",
              copyFailed
                ? "border-destructive text-destructive"
                : "text-muted hover:border-accent hover:text-accent",
              !dayOfferText && "opacity-40",
            )}
          >
            <Copy size={12} />
            {copyFailed ? "Copy failed" : `Copy times for ${shownWeekday}`}
          </button>
          <button
            type="button"
            onClick={() => copyOffer(offerText)}
            disabled={!offerText}
            title={
              offerText
                ? "Copy a ready-to-send text offering the next open times"
                : "No open times to offer"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold transition-colors",
              copyFailed
                ? "border-destructive text-destructive"
                : "text-muted hover:border-accent hover:text-accent",
              !offerText && "opacity-40",
            )}
          >
            <Copy size={12} />
            {copyFailed ? "Copy failed" : "Copy times for lead"}
          </button>
        </span>
      </div>

      {/* Confirmation + reference while they switch to the SMS thread: the
          copied text verbatim, dismissable, never blocking. */}
      <Toast
        key={copies}
        open={toastOpen}
        onClose={() => setToastOpen(false)}
        title="Copied to clipboard"
      >
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-muted">
          {copiedText}
        </p>
      </Toast>

      {/* The day strip. Every segment is labelled for what it is: open days
          tap, closed days say so, and the day holding the current selection
          keeps a dot even while another day is being browsed. */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const closed = !hoursForDay(schedule, d.key);
          const isShown = d.key === shownDay;
          const holdsSelection = d.key === date;
          return (
            <button
              key={d.key}
              type="button"
              disabled={closed}
              aria-label={`Day ${d.key}`}
              aria-pressed={isShown}
              onClick={() => setViewed(d.key)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg border py-1.5 transition-colors",
                isShown
                  ? "border-accent bg-accent text-white"
                  : closed
                    ? "cursor-not-allowed border-line/60 bg-bg/60 text-muted/50"
                    : "border-line bg-white text-ink hover:border-accent hover:text-accent",
              )}
            >
              <span
                className={cn(
                  "text-[9.5px] font-bold uppercase tracking-wide",
                  isShown ? "text-white/85" : d.isToday && !closed ? "text-accent" : "text-muted",
                  closed && "text-muted/50",
                )}
              >
                {d.isToday ? "Today" : formatKey(d.key, { weekday: "short" })}
              </span>
              <span className="text-[13px] font-semibold leading-none">{d.date.getDate()}</span>
              {closed ? (
                <span className="text-[8.5px] font-semibold uppercase">closed</span>
              ) : (
                <span
                  className={cn(
                    "h-1 w-1 rounded-full",
                    holdsSelection ? (isShown ? "bg-white" : "bg-accent") : "bg-transparent",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* The shown day's times. Sections only when the day actually spans
          them — a 10-to-2 Saturday doesn't need a "Morning" heading over
          what is obviously the whole list. */}
      <div className="mt-3">
        {shownSlots === null ? (
          <p className="py-3 text-center text-[12.5px] italic text-muted">
            Closed this day - pick another, or change the hours in Settings.
          </p>
        ) : shownSlots.length === 0 ? (
          <p className="py-3 text-center text-[12.5px] italic text-muted">
            Nothing left today - try tomorrow.
          </p>
        ) : (
          sectionsOf(shownSlots).map(({ label, slots, only }) => (
            <div key={label} className={only ? undefined : "mb-2.5 last:mb-0"}>
              {!only && (
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted">
                  {label}
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {slots.map((s) => {
                  const booking = taken.get(shownDay)?.get(s.min);
                  const isSelected = shownDay === date && selectedSlot === s.min;
                  if (booking) {
                    return (
                      <span
                        key={s.min}
                        title={`${s.label} · ${booking.name}`}
                        className={cn(
                          "flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border border-line/60 bg-bg px-1.5 text-[11.5px] font-medium text-muted",
                          // A hand-set time can still land on a taken slot
                          // (stale data, reschedule races) — flag, don't hide.
                          isSelected && "ring-2 ring-status-awaiting",
                        )}
                      >
                        <span className="truncate">
                          {s.label} · {booking.name.split(/\s+/)[0]}
                        </span>
                      </span>
                    );
                  }
                  return (
                    <button
                      key={s.min}
                      type="button"
                      aria-label={`Book ${shownDay} ${s.label}`}
                      onClick={() => onPick({ date: shownDay, time: s.value })}
                      className={cn(
                        "h-8 rounded-lg border text-[12.5px] font-medium transition-colors",
                        isSelected
                          ? "border-accent bg-accent text-white"
                          : "border-line bg-white text-ink hover:border-accent hover:text-accent",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {(offGrid.length > 0 || clash) && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          {offGrid.map((a) => (
            <p key={a.id} className="text-[11.5px] text-muted">
              Also booked{" "}
              <span className="font-semibold text-ink">
                {shortDay(a.pickupDate)}
                {a.pickupTime ? ` "${a.pickupTime}"` : " (no time)"}
              </span>
              : {a.name} — off the grid, check before booking nearby.
            </p>
          ))}
          {clash && (
            <p className="text-[12px] font-semibold text-status-awaiting">
              {fmtApptTime(time)} clashes with {clash.name}&apos;s meetup. Pick a free slot, or it
              will need an explicit &quot;book anyway&quot;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Calendly's day-part boundaries, in minutes since midnight.
const SECTIONS = [
  { label: "Morning", from: 0, to: 12 * 60 },
  { label: "Afternoon", from: 12 * 60, to: 17 * 60 },
  { label: "Evening", from: 17 * 60, to: 24 * 60 },
];

/** Slots grouped by day-part; `only` set when the day never leaves one. */
function sectionsOf(slots) {
  const groups = SECTIONS.map((sec) => ({
    label: sec.label,
    slots: slots.filter((s) => s.min >= sec.from && s.min < sec.to),
  })).filter((g) => g.slots.length > 0);
  return groups.map((g) => ({ ...g, only: groups.length === 1 }));
}

function shortDay(key) {
  return formatKey(key, { weekday: "short", month: "short", day: "numeric" }) || key;
}
