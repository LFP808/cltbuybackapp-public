import { displayStage, needsAnotherAttempt, isCancelled, isWalkIn } from "./orders";
import { parseLocalDate } from "./dates";

/**
 * The three questions the orders list gets asked: WHEN, WHAT KIND, and WHERE
 * IN ITS LIFE. Kept here rather than in the component so each is a plain
 * function over an order, and so "this week" means the same thing everywhere.
 */

/**
 * Ranges this list offers, and the default.
 *
 * `month` rather than everything: a list that opens on every order ever
 * eventually opens on a thousand rows, most of them finished. The useful
 * default is the period someone is actually working, with the rest a click
 * away instead of in the way.
 */
export const ORDER_RANGES = ["day", "week", "month", "30d", "90d", "upcoming", "all", "custom"];
export const DEFAULT_RANGE = "month";

/**
 * The date an order belongs to: its APPOINTMENT. Booking a meetup for the
 * 3rd of next month makes it next month's work, and filing it under the day
 * someone typed it in puts it in a month nobody will be looking at when it
 * comes round.
 *
 * Falls back to created for an order with no date yet — a booking that still
 * needs a time rather than one that belongs nowhere — and for walk-ins,
 * which happened the day they were entered.
 */
export function orderDate(order) {
  const scheduled = order?.pickupDate || null;
  if (scheduled) {
    // Stored as YYYY-MM-DD. Parsed at local midnight, not UTC, or a morning
    // appointment lands on the previous day west of Greenwich.
    const d = parseLocalDate(scheduled);
    if (d) return d.getTime();
  }
  return order?.createdAt || 0;
}

/**
 * Whether an order falls in a resolved range, dated by orderDate.
 *
 * The window itself comes from domain/date-range, the same resolver the
 * overview uses — only the DATE is orders-specific.
 */
export function inRange(order, range) {
  const at = orderDate(order);
  return at >= range.from && at <= range.to;
}

/**
 * How the seller reached us, as tabs. Meetups and walk-ins share a type and
 * are told apart by the flag — the same split orderTypeLabel() makes — so
 * the tab keys here are NOT type values and go through matchesType, never a
 * raw comparison.
 */
export const TYPE_TABS = [
  { key: "all", label: "All" },
  { key: "office", label: "Meetups" },
  { key: "walkin", label: "Walk-ins" },
];

export function matchesType(order, key) {
  if (key === "all") return true;
  if (key === "walkin") return isWalkIn(order);
  return order?.type === "office" && !isWalkIn(order);
}

/**
 * Where the order is in its life. `failedstop` is a flag rather than a stage
 * — a no-show goes straight back to awaiting, visible to nobody without
 * this pill.
 */
export const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting" },
  { key: "received", label: "Bought" },
  { key: "paid", label: "Paid" },
  { key: "failedstop", label: "No-show" },
  // Last on purpose: cancelled orders are records, not work. "All" leaves
  // them out (below), so this pill is the one place to find them.
  { key: "cancelled", label: "Cancelled" },
  // Same again for admin-deleted orders: the row is kept as a record, and
  // this is where to read it. displayStage() tells the two apart, so the
  // Cancelled pill does not also list the deleted ones.
  { key: "deleted", label: "Deleted" },
];

export function matchesStatus(order, key) {
  // "All" means all the LIVE work, not all the rows. A cancelled order in
  // the default view added its estimate to the running total — money that
  // will never move, on an order that no longer exists as work.
  if (key === "all") return !isCancelled(order);
  if (key === "failedstop") return needsAnotherAttempt(order);
  return displayStage(order) === key;
}

/**
 * Status filters worth offering for the type on screen. One list for every
 * tab today — a walk-in is never awaiting, but the empty answer reads as
 * "none right now" rather than broken, and hiding pills per-tab is a
 * decision to make when a tab actually needs it.
 */
export function statusFiltersFor(typeKey) {
  return STATUS_FILTERS;
}

/** Text search across the fields staff actually remember. */
export function matchesQuery(order, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Boolean(
    order.name?.toLowerCase().includes(q) || order.phone?.includes(q.replace(/\D/g, "")),
  );
}
