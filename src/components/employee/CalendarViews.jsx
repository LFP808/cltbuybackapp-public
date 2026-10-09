"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, CalendarClock } from "lucide-react";
import { MonthCalendar } from "./MonthCalendar";
import { WeekAgenda } from "./WeekAgenda";
import { DayView } from "./DayView";
import { CashFloat } from "./CashFloat";
import { useRealtime } from "@/lib/use-realtime";
import { cn } from "@/lib/cn";

/**
 * Three ways to read the same work, because three jobs need different shapes.
 *
 *   MONTH  "how busy is August" — the wide view.
 *   WEEK   "what is this week's work" — an agenda with every meetup as a full
 *          card and the free days visible, which is the planning shape.
 *   DAY    "who is coming, and what are they bringing" — the counter's view
 *          of today, with the phone number and the expected devices in reach.
 */
export function CalendarViews({ calendarOrders, float }) {
  const router = useRouter();
  const [view, setView] = useState("month");
  // Carried between the two so "open this day" from the grid lands on the day
  // you clicked, not on today.
  const [day, setDay] = useState(null);

  // A booking, reschedule, cancellation or no-show changes `orders` — any of
  // which should move what the counter sees without a manual refresh. One
  // subscription for all three tabs since they all read the same prop; a
  // server round-trip re-derives everything (including the float) from one
  // source of truth, same pattern as InboundAlerts/LeadAlerts.
  useRealtime({
    channel: "calendar-orders",
    table: "orders",
    enabled: true,
    onChange: useCallback(() => router.refresh(), [router]),
  });

  const tabs = [
    { key: "month", label: "Month", icon: CalendarDays },
    { key: "week", label: "Week", icon: CalendarRange },
    { key: "day", label: "Day", icon: CalendarClock },
  ];

  return (
    <div>
      {/* Full width on a phone so three tabs share the row evenly. */}
      <div className="mb-4 flex w-full rounded-pill border-[1.5px] border-line bg-white p-1 sm:inline-flex sm:w-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              aria-pressed={view === t.key}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill px-2 py-1.5 text-[13px] font-semibold transition-colors sm:flex-none sm:px-3.5",
                view === t.key ? "bg-accent text-white" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {view === "month" && (
        <MonthCalendar
          orders={calendarOrders}
          onOpenDay={(d) => {
            setDay(d);
            setView("day");
          }}
        />
      )}
      {view === "week" && (
        <WeekAgenda
          orders={calendarOrders}
          onOpenDay={(d) => {
            setDay(d);
            setView("day");
          }}
        />
      )}
      {/* On the view someone reads before opening up, and not on the month
          grid — "how much cash for today" is not a question you ask while
          looking at October. */}
      {view === "day" && <CashFloat float={float} />}

      {view === "day" && <DayView orders={calendarOrders} initialDay={day} />}
    </div>
  );
}
