"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import {
  groupByDay,
  monthGrid,
  monthLabel,
  eventKind,
  EVENT_KINDS,
  WEEKDAYS,
} from "@/domain/calendar-events";
import { dayKey, parseLocalDate } from "@/domain/dates";
import { fmtApptTime } from "@/domain/format";
import { EventCard } from "./EventCard";
import { cn } from "@/lib/cn";

/**
 * The month at a glance: every booked meetup.
 *
 * Selecting a day opens it below rather than in a popover — on a phone a
 * popover over a grid this dense is unusable, and the day's detail is the thing
 * you actually act on, so it deserves real room.
 */
export function MonthCalendar({ orders = [], onOpenDay }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(dayKey(today));

  const byDay = useMemo(() => groupByDay(orders), [orders]);
  const cells = useMemo(
    () => monthGrid(cursor.year, cursor.month, today),
    // A new Date() each render would make this dependency useless; the day only
    // matters to the point of highlighting "today", which cannot change while
    // someone is looking at it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cursor.year, cursor.month],
  );

  const move = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const monthCount = cells.reduce(
    (n, c) => (c.inMonth ? n + (byDay.get(c.key)?.length || 0) : n),
    0,
  );
  const selectedOrders = byDay.get(selected) || [];

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <button
            onClick={() => move(-1)}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-0 font-serif text-[15px] text-ink">
            {monthLabel(cursor.year, cursor.month)}
          </span>
          <button
            onClick={() => move(1)}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => {
              const n = new Date();
              setCursor({ year: n.getFullYear(), month: n.getMonth() });
              setSelected(dayKey(n));
            }}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-accent hover:text-accent"
          >
            Today
          </button>
          <span className="ml-auto text-[12px] text-muted">
            {monthCount} {monthCount === 1 ? "job" : "jobs"} this month
          </span>
        </div>

        {/* Seven columns at every width. A month grid that reflows into a list
            stops being a month, and the cells stay tappable because the day
            detail below is where the reading happens. */}
        <div className="grid grid-cols-7 border-b border-line bg-bg/60">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-1 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted"
            >
              <span className="hidden sm:inline">{d}</span>
              <span className="sm:hidden">{d[0]}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const items = byDay.get(cell.key) || [];
            const isSelected = cell.key === selected;
            return (
              <button
                key={cell.key}
                onClick={() => setSelected(cell.key)}
                className={cn(
                  "min-h-[3.75rem] border-b border-r border-line p-1 text-left align-top transition-colors sm:min-h-[5.5rem]",
                  !cell.inMonth && "bg-bg/40",
                  isSelected ? "bg-accent-l/60" : "hover:bg-bg",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    cell.isToday
                      ? "bg-accent text-white"
                      : cell.inMonth
                        ? "text-ink"
                        : "text-muted/50",
                  )}
                >
                  {cell.date.getDate()}
                </span>

                {/* DOTS ON A PHONE, NAMES ON A DESKTOP. A 45px-wide cell
                    truncates every name to "ZZ …", which tells you something is
                    there but not what — worse than not pretending to. A dot per
                    job says how busy the day is, which is all a month view owes
                    you; the panel below is where the reading happens. */}
                <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                  {items.slice(0, 4).map((o) => (
                    <span
                      key={o.id}
                      className={cn("h-1.5 w-1.5 rounded-full", EVENT_KINDS[eventKind(o)].dot)}
                    />
                  ))}
                  {items.length > 4 && (
                    <span className="text-[9px] font-bold leading-none text-muted">
                      +{items.length - 4}
                    </span>
                  )}
                </span>

                <span className="mt-0.5 hidden space-y-0.5 sm:block">
                  {items.slice(0, 2).map((o) => (
                    <span
                      key={o.id}
                      className={cn(
                        "block truncate rounded px-1 py-0.5 text-[10px] font-semibold",
                        EVENT_KINDS[eventKind(o)].tone,
                      )}
                    >
                      {o.pickupTime ? `${fmtApptTime(o.pickupTime)} ` : ""}
                      {o.name}
                    </span>
                  ))}
                  {items.length > 2 && (
                    <span className="block px-1 text-[10px] font-semibold text-muted">
                      +{items.length - 2} more
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <DayPanel day={selected} orders={selectedOrders} onOpenDay={onOpenDay} />
    </div>
  );
}

/** What is actually happening on the selected day. */
function DayPanel({ day, orders, onOpenDay }) {
  const date = parseLocalDate(day) ?? new Date();
  const heading = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="font-serif text-[15px] text-ink">{heading}</h2>
        <span className="text-[12px] text-muted">
          {orders.length === 0
            ? "Nothing scheduled"
            : `${orders.length} ${orders.length === 1 ? "job" : "jobs"}`}
        </span>
        {orders.length > 0 && onOpenDay && (
          // Phone numbers and expected items live in the day view; repeating
          // them in a month cell would make the grid unreadable.
          <button
            onClick={() => onOpenDay(day)}
            className="ml-auto text-[12px] font-semibold text-accent hover:underline"
          >
            Open day
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <Card className="text-[13px] italic text-muted">Nothing scheduled for this day.</Card>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <EventCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}
