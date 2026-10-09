"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight, AlertCircle, BellOff, Calendar, DoorClosed } from "lucide-react";
import { StatusBadge, Badge, Card, EmptyState, Button, Modal } from "@/components/ui";
import { isOverdueLocal, needsAnotherAttempt, stopOutcomeLabel } from "@/domain/orders";
import { fmtPhone, currency } from "@/domain/format";
import {
  ORDER_RANGES,
  DEFAULT_RANGE,
  TYPE_TABS,
  inRange,
  matchesType,
  matchesStatus,
  matchesQuery,
  statusFiltersFor,
} from "@/domain/order-filters";
import { resolveRange } from "@/domain/date-range";
import { DateRangePicker } from "@/components/employee/dashboard/DateRangePicker";
import { cn } from "@/lib/cn";

/** Searchable, filterable list of orders. Pure client interactivity over
 *  server-provided data. */
export function OrdersList({ shipments, truncated = false }) {
  const [query, setQuery] = useState("");
  const [rangeKey, setRangeKey] = useState(DEFAULT_RANGE);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [type, setType] = useState("all");
  const [filter, setFilter] = useState("all");

  // Resolved once per render, so every order in one pass is judged against the
  // same window — and by the same resolver the overview uses.
  const range = useMemo(
    () => resolveRange({ range: rangeKey, from: customFrom, to: customTo }),
    [rangeKey, customFrom, customTo],
  );

  const filtered = useMemo(
    () =>
      shipments.filter(
        (s) =>
          inRange(s, range) &&
          matchesType(s, type) &&
          matchesStatus(s, filter) &&
          matchesQuery(s, query),
      ),
    [shipments, query, range, type, filter],
  );

  // What the current view is worth. A filtered list with no total makes you
  // add it up yourself, which is the question you were asking by filtering.
  // Except on the Cancelled pill: those orders were never paid, so the only
  // number available is the intake estimate, and a dollar figure over dead
  // orders reads as money when it is a guess about deals that fell through.
  // Zero here is how the summary row hides the total. Deleted orders the
  // same, more so: their payout was struck from the books on purpose.
  const total = useMemo(
    () =>
      filter === "cancelled" || filter === "deleted"
        ? 0
        : filtered.reduce((sum, s) => sum + (Number(s.paidAmount) || Number(s.estValue) || 0), 0),
    [filtered, filter],
  );

  // Switching tabs can leave a status selected the new tab doesn't offer,
  // which would silently show nothing at all.
  const statusOptions = statusFiltersFor(type);
  function changeType(next) {
    setType(next);
    if (!statusFiltersFor(next).some((f) => f.key === filter)) setFilter("all");
  }

  return (
    <div>
      {/* Type first: it changes what the other controls even mean.
          Full width on a phone so the tabs share the row evenly instead of
          leaving the date chip stranded on a line of its own. */}
      <div className="mb-2 flex w-full rounded-pill border-[1.5px] border-line bg-white p-1 sm:inline-flex sm:w-auto">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => changeType(t.key)}
            aria-pressed={type === t.key}
            className={cn(
              "flex-1 rounded-pill px-2 py-1.5 text-[13px] font-semibold transition-colors sm:flex-none sm:px-3.5",
              type === t.key ? "bg-accent text-white" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Modal open={rangeOpen} onClose={() => setRangeOpen(false)} title="Date range">
        <DateRangePicker
          value={rangeKey}
          onChange={setRangeKey}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
          allow={ORDER_RANGES}
        />
        <p className="mt-3 text-[12px] text-muted">
          Meetups are dated by their appointment; walk-ins by when they happened.
        </p>
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <Button onClick={() => setRangeOpen(false)}>Done</Button>
        </div>
      </Modal>

      {/* Search and the date range share a row. The chip used to be up with the
          tabs, where on a phone it wrapped onto a line of its own with nothing
          beside it — a whole row spent on one control. */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border-[1.5px] border-line bg-white px-3 py-2">
          <Search size={16} className="flex-shrink-0 text-muted" />
          {/* Short placeholder on a phone: the long one truncated mid-word,
              which reads as a broken field rather than a hint. */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none sm:hidden"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone…"
            className="hidden min-w-0 flex-1 bg-transparent text-[13.5px] outline-none sm:block"
          />
        </div>

        {/* Same chip-and-modal as the overview, from the same component — the
            two screens can't drift into different ideas of "this month". */}
        <button
          onClick={() => setRangeOpen(true)}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-2 text-[12.5px] font-medium text-ink shadow-xs transition-colors hover:border-accent/40"
        >
          <Calendar size={13} className="text-accent" />
          {range.label}
        </button>
      </div>

      {/* Status pills and the running total share the last row, so the count
          sits with the filters that determine it. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {statusOptions.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-pill border px-3 py-1.5 text-[12px] font-semibold transition-colors",
              filter === f.key
                ? "border-accent bg-accent text-white"
                : "border-line bg-white text-muted hover:border-accent",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto whitespace-nowrap text-[12.5px] text-muted">
          <span className="font-semibold text-ink">{filtered.length}</span>
          {filtered.length === 1 ? " order" : " orders"}
          {total > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-accent">{currency(total)}</span>
            </>
          )}
        </span>
      </div>

      {/* Says so rather than quietly showing part of the list. */}
      {truncated && (
        <Card className="mb-3 text-[12.5px] text-muted">
          Showing the {shipments.length} most recent orders. Older ones are still searchable from a
          customer&apos;s page.
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card>
          {/* Says which control is hiding things. "No orders match" over a list
              that defaults to this month reads as "there are none", and the fix
              — widen the period — isn't obvious from it. */}
          <EmptyState icon={AlertCircle}>
            No orders match.
            {range.key !== "all" && (
              <>
                {" "}
                <button
                  onClick={() => {
                    setRangeKey("all");
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  className="font-semibold text-accent underline"
                >
                  Search all time
                </button>
                ?
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => {
            return (
              <Card
                key={s.id}
                className="flex items-center gap-3 p-4 transition-colors hover:border-accent"
              >
                <Link href={`/orders/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-bold text-ink">{s.name}</span>
                      <StatusFlag shipment={s} />
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted">{fmtPhone(s.phone)}</div>
                  </div>
                  <StatusBadge order={s} />
                  <ChevronRight size={16} className="text-muted" />
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The flag beside a customer's name. Deliberately literal — it says what
 * happened, not how staff should feel about it, which is what makes it
 * scannable down a long list.
 */
function StatusFlag({ shipment }) {
  // FIRST: a meetup that failed is the one flag that needs a human decision
  // today — rebook it, or call the customer. It used to surface nowhere
  // outside the order itself, so "didn't show" quietly became nothing.
  if (needsAnotherAttempt(shipment)) {
    return (
      <Badge className="bg-status-awaiting-bg text-status-awaiting">
        <DoorClosed size={10} /> {stopOutcomeLabel(shipment.stopOutcome)}
      </Badge>
    );
  }
  if (shipment.remindersCancelledAt) {
    return (
      <Badge className="bg-bg text-muted">
        <BellOff size={10} /> Opted out
      </Badge>
    );
  }
  if (isOverdueLocal(shipment)) {
    return <Badge className="bg-status-awaiting-bg text-status-awaiting">Meetup overdue</Badge>;
  }
  return null;
}
