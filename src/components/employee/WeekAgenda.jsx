"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import { groupByDay, weekDays, weekLabel } from "@/domain/calendar-events";
import { addDays, parseLocalDate } from "@/domain/dates";
import { currency } from "@/domain/format";
import { EventCard } from "./EventCard";
import { cn } from "@/lib/cn";

/**
 * The week as an agenda: seven days in a scroll, every job as a full card.
 *
 * The month grid answers "how busy is August"; this answers "what is this
 * week's work" — the planning question asked while booking, or deciding
 * whether Thursday can take one more meetup. Days are shown even when empty,
 * because a free day IS the answer being looked for.
 *
 * Same cards as the month view's day panel (EventCard) — two views drawing
 * the same job differently is how confusion starts.
 */
export function WeekAgenda({ orders = [], onOpenDay }) {
  // The Monday key anchors the cursor; navigation moves it whole weeks.
  const [anchor, setAnchor] = useState(() => new Date());

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const byDay = useMemo(() => groupByDay(orders), [orders]);

  const jobs = days.reduce((n, d) => n + (byDay.get(d.key)?.length || 0), 0);
  const isThisWeek = days.some((d) => d.isToday);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <button
          onClick={() => setAnchor((a) => addDays(a, -7))}
          aria-label="Previous week"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-serif text-[15px] text-ink">{weekLabel(days)}</span>
        <button
          onClick={() => setAnchor((a) => addDays(a, 7))}
          aria-label="Next week"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
        {!isThisWeek && (
          <button
            onClick={() => setAnchor(new Date())}
            className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-accent hover:text-accent"
          >
            This week
          </button>
        )}
        <span className="ml-auto text-[12px] text-muted">
          {jobs} {jobs === 1 ? "job" : "jobs"} this week
        </span>
      </Card>

      {days.map((day) => (
        <DaySection
          key={day.key}
          day={day}
          orders={byDay.get(day.key) || []}
          onOpenDay={onOpenDay}
        />
      ))}
    </div>
  );
}

function DaySection({ day, orders, onOpenDay }) {
  const date = parseLocalDate(day.key) ?? day.date;
  const value = orders.reduce((sum, o) => sum + (Number(o.estValue) || 0), 0);

  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <h3
          className={cn(
            "font-serif text-[14px]",
            day.isToday ? "text-accent" : "text-ink",
          )}
        >
          {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          {day.isToday ? " · Today" : ""}
        </h3>
        <span className="text-[12px] text-muted">
          {orders.length === 0
            ? "Nothing scheduled"
            : `${orders.length} ${orders.length === 1 ? "job" : "jobs"}${
                value > 0 ? ` · ${currency(value)}` : ""
              }`}
        </span>
        {orders.length > 0 && onOpenDay && (
          <button
            onClick={() => onOpenDay(day.key)}
            className="ml-auto text-[12px] font-semibold text-accent hover:underline"
          >
            Open day
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        // A slim rule, not a card: seven "nothing" cards would bury the work
        // between them, and an empty day only needs to be visibly free.
        <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] italic text-muted/70">
          Free
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <EventCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </section>
  );
}
