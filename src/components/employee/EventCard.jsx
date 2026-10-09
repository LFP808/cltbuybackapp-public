import Link from "next/link";
import { Users } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { eventKind, EVENT_KINDS } from "@/domain/calendar-events";
import { fmtPhone, currency, fmtApptTime } from "@/domain/format";
import { cn } from "@/lib/cn";

const ICONS = { office: Users };

/**
 * One calendar event as a tappable card — name, time, phone, estimated value.
 * Extracted from the month view's day panel when the week agenda needed the
 * identical card: two views drawing the same job differently is how "is that
 * the same appointment?" questions start.
 */
export function EventCard({ order }) {
  const kind = eventKind(order);
  const Icon = ICONS[kind];
  return (
    <Link href={`/orders/${order.id}`} className="block">
      <Card className="flex items-center gap-3 p-3.5 transition-colors hover:border-accent">
        <span
          className={cn(
            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
            EVENT_KINDS[kind].tone,
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13.5px] font-bold text-ink">{order.name}</span>
            <span className="text-[11px] font-semibold text-muted">
              {EVENT_KINDS[kind].label}
              {order.pickupTime ? ` · ${fmtApptTime(order.pickupTime)}` : ""}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            <span>{fmtPhone(order.phone)}</span>
            {order.estValue > 0 && <span>· {currency(order.estValue)}</span>}
          </div>
        </div>
        <StatusBadge order={order} />
      </Card>
    </Link>
  );
}
