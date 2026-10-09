"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Phone,
  MessageSquare,
  Users,
  ChevronRight as Arrow,
} from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { groupByDay, eventKind, EVENT_KINDS } from "@/domain/calendar-events";
import { dayKey, parseLocalDate } from "@/domain/dates";
import { fmtPhone, currency, fmtApptTime } from "@/domain/format";
import { stopOutcomeLabel } from "@/domain/orders";
import { cn } from "@/lib/cn";

const ICONS = { office: Users };

/**
 * One day, in enough detail to work from.
 *
 * The month grid answers "when"; this answers "who is coming and what are
 * they bringing" — which is what the person at the counter actually needs.
 * The number goes to the customer's thread, and the items are listed so the
 * devices on the table can be checked against what was agreed.
 */
export function DayView({ orders = [], initialDay }) {
  const [day, setDay] = useState(initialDay || dayKey(new Date()));
  const byDay = groupByDay(orders);
  const stops = byDay.get(day) || [];

  const shift = (delta) => {
    // Always a dayKey() value in practice; the fallback keeps a malformed one
    // from turning into a crashed page.
    const d = parseLocalDate(day) ?? new Date();
    d.setDate(d.getDate() + delta);
    setDay(dayKey(d));
  };

  const date = parseLocalDate(day) ?? new Date();
  const isToday = day === dayKey(new Date());
  const value = stops.reduce((sum, o) => sum + (Number(o.estValue) || 0), 0);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <button
          onClick={() => shift(-1)}
          aria-label="Previous day"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="font-serif text-[15px] leading-tight text-ink">
            {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div className="text-[11.5px] text-muted">
            {stops.length === 0
              ? "Nothing scheduled"
              : `${stops.length} ${stops.length === 1 ? "meetup" : "meetups"}${
                  value > 0 ? ` · ${currency(value)} expected` : ""
                }`}
          </div>
        </div>
        <button
          onClick={() => shift(1)}
          aria-label="Next day"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
        {!isToday && (
          <button
            onClick={() => setDay(dayKey(new Date()))}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-muted hover:border-accent hover:text-accent"
          >
            Today
          </button>
        )}
      </Card>

      {stops.length === 0 ? (
        <Card className="text-[13px] italic text-muted">Nothing scheduled.</Card>
      ) : (
        stops.map((o, i) => <Stop key={o.id} order={o} index={i + 1} />)
      )}
    </div>
  );
}

function Stop({ order, index }) {
  const kind = eventKind(order);
  const Icon = ICONS[kind];

  return (
    <Card className="p-0">
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={cn(
            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
            EVENT_KINDS[kind].tone,
          )}
        >
          {index}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
              <Icon size={11} className="mr-1 inline" />
              {EVENT_KINDS[kind].label}
            </span>
            {order.pickupTime && (
              <span className="font-serif text-[15px] text-ink">
                {fmtApptTime(order.pickupTime)}
              </span>
            )}
          </div>
          <div className="mt-0.5 break-words text-[14px] font-bold text-ink">{order.name}</div>
        </div>

        <div className="flex-shrink-0">
          <StatusBadge order={order} />
        </div>
      </div>

      {/* Who, and how to reach them.
          Both go to the conversation for this one customer rather than handing
          off to the phone's own apps. sms: opens a thread from a personal
          number that nobody else can see and that never reaches the customer
          record; this keeps the exchange where the next person will look for
          it. The Call button on that screen is a real tel: link, so dialling
          is still one more tap and no more. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
        <span className="text-[13px] font-semibold text-ink">{fmtPhone(order.phone)}</span>
        <Link
          href={`/orders/${order.id}/message`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-accent hover:text-accent"
        >
          <Phone size={13} /> Call
        </Link>
        <Link
          href={`/orders/${order.id}/message`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-accent hover:text-accent"
        >
          <MessageSquare size={13} /> Text
        </Link>
      </div>

      {/* What they say they are bringing, so the devices on the table can be
          checked against it. */}
      {order.items?.length > 0 && (
        <div className="border-t border-line px-3.5 py-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
            Expecting
          </div>
          <ul className="space-y-0.5">
            {order.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 text-ink">
                  {it.quantity > 1 && <span className="text-muted">{it.quantity}× </span>}
                  {it.name}
                </span>
                {Number(it.price) > 0 && (
                  <span className="flex-shrink-0 font-semibold text-accent">
                    {currency(Number(it.price) * (Number(it.quantity) || 1))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {order.stopOutcome && (
        <p className="border-t border-line bg-status-awaiting-bg/40 px-3.5 py-2 text-[12px] text-status-awaiting">
          Last attempt: {stopOutcomeLabel(order.stopOutcome)}
          {order.stopOutcomeNote ? ` - ${order.stopOutcomeNote}` : ""}
        </p>
      )}

      <Link
        href={`/orders/${order.id}`}
        className="flex items-center justify-between border-t border-line px-3.5 py-2.5 text-[13px] font-bold text-accent hover:bg-accent-l/40"
      >
        Open order to buy or report a no-show
        <Arrow size={15} />
      </Link>
    </Card>
  );
}
