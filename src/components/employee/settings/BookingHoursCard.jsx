"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Card, Button } from "@/components/ui";
import { slotValue, WEEKDAY_KEYS } from "@/domain/booking";
import { uid } from "@/domain/format";
import { saveBookingScheduleAction } from "@/app/employee/settings/actions";

const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The booking schedule, editable in place: hours for each weekday (or closed),
 * plus special dates — a holiday shut, a short Christmas Eve.
 *
 * Takes the CURRENT normalized schedule from the server, so what the rows
 * show on load is exactly what the booking grid is offering right now —
 * defaults included. A closed day keeps its last times in state so reopening
 * doesn't ask them to be retyped. Refusals from the save action arrive
 * naming the day or date they're about, and land verbatim in the red line.
 */
export function BookingHoursCard({ schedule }) {
  const [week, setWeek] = useState(() =>
    schedule.week.map((w) => ({
      open: Boolean(w),
      start: w ? slotValue(w.startMin) : "08:00",
      end: w ? slotValue(w.endMin) : "20:00",
    })),
  );
  const [dates, setDates] = useState(() =>
    Object.entries(schedule.dates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, w]) => ({
        id: uid(),
        date,
        closed: !w,
        start: w ? slotValue(w.startMin) : "08:00",
        end: w ? slotValue(w.endMin) : "20:00",
      })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const setDay = (i, patch) => setWeek((w) => w.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setDate = (id, patch) =>
    setDates((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await saveBookingScheduleAction({
        week: Object.fromEntries(
          WEEKDAY_KEYS.map((key, i) => [
            key,
            week[i].open ? { start: week[i].start, end: week[i].end } : null,
          ]),
        ),
        dates: dates.map(({ date, closed, start, end }) => ({ date, closed, start, end })),
      });
      if (result?.error) setError(result.error);
      else setSaved(true);
    } catch (err) {
      setError(err?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="text-[14px] font-bold text-ink">Booking hours</div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        What the booking grid offers, day by day. Odd hours can still be typed into the time field
        by hand.
      </p>

      <div className="mt-3 space-y-1.5">
        {DAY_LABELS.map((label, i) => (
          <div key={label} className="flex flex-wrap items-center gap-2">
            <label className="flex w-28 items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                checked={week[i].open}
                onChange={(e) => setDay(i, { open: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              {label}
            </label>
            {week[i].open ? (
              <>
                <TimeInput value={week[i].start} onChange={(v) => setDay(i, { start: v })} />
                <span className="text-[12px] text-muted">to</span>
                <TimeInput value={week[i].end} onChange={(v) => setDay(i, { end: v })} />
              </>
            ) : (
              <span className="text-[12.5px] italic text-muted">Closed</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink">Special dates</div>
        <p className="mt-0.5 text-[12px] text-muted">
          A date here overrides that day&apos;s usual hours - a holiday shut, a short day.
        </p>
        <div className="mt-2 space-y-1.5">
          {dates.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={row.date}
                onChange={(e) => setDate(row.id, { date: e.target.value })}
                className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] outline-none focus:border-accent"
              />
              <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  checked={row.closed}
                  onChange={(e) => setDate(row.id, { closed: e.target.checked })}
                  className="h-4 w-4 accent-accent"
                />
                Closed
              </label>
              {!row.closed && (
                <>
                  <TimeInput value={row.start} onChange={(v) => setDate(row.id, { start: v })} />
                  <span className="text-[12px] text-muted">to</span>
                  <TimeInput value={row.end} onChange={(v) => setDate(row.id, { end: v })} />
                </>
              )}
              <button
                type="button"
                aria-label={`Remove ${row.date || "this date"}`}
                onClick={() => setDates((rows) => rows.filter((r) => r.id !== row.id))}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="mt-2"
          onClick={() =>
            setDates((rows) => [
              ...rows,
              { id: uid(), date: "", closed: true, start: "08:00", end: "20:00" },
            ])
          }
        >
          <Plus size={14} /> Add a date
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save schedule"}
        </Button>
        {saved && (
          <span className="text-[12px] font-semibold text-accent">
            Saved - the booking grid follows it immediately.
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-500">{error}</p>}
    </Card>
  );
}

function TimeInput({ value, onChange }) {
  return (
    <input
      type="time"
      step={900}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] outline-none focus:border-accent"
    />
  );
}
