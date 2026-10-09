import { needsFollowUp, isOpen, displayStage, isCancelled, isDeleted } from "./orders";
import { STAGES } from "./constants";
import { startOfWeek, startOfMonth, addMonths } from "./dates";

const DAY = 86400000;

// Ranges moved to domain/date-range so the overview and the orders list share
// one definition of "this month". Re-exported here because callers already
// import resolveRange from this module.
export { resolveRange } from "./date-range";

/**
 * Range-aware admin metrics. Order-derived figures are scoped to the selected
 * window; a small `current` block holds point-in-time state (open orders,
 * follow-ups, unanswered replies) that is always "now", independent of range.
 *
 * @param {import('./types').Shipment[]} shipments
 * @param {Array<object>} customers  CustomerSummary[]
 * @param {{from:number,to:number,label:string}} range
 */
export function computeDashboardMetrics(shipments, customers, range) {
  const { from, to, label } = range;
  // A DELETED order is struck from the books entirely — not even a lost
  // conversion. It is excluded before anything is counted, unlike a cancel,
  // which stays in the denominator below because the customer really did
  // book and then back out.
  const taken = shipments.filter((s) => !isDeleted(s) && s.createdAt >= from && s.createdAt <= to);
  // Cancelled orders are records, not work: they leave every count, dollar
  // figure and breakdown below, or one dead $200 estimate inflates a month.
  // Conversion is the one deliberate exception — a customer who booked and
  // then cancelled is a lost conversion, and dropping them from the
  // denominator would quietly improve the rate at the moment an order dies.
  // So the rate divides by everything TAKEN in the window, the rest of the
  // panel reads the live set, and `cancelledInPeriod` is surfaced beside the
  // count so paid/orders visibly reconciles with the percentage.
  const inRange = taken.filter((s) => !isCancelled(s));
  const cancelledInPeriod = taken.length - inRange.length;

  // --- Pipeline / orders (in period) ----------------------------------------
  // BRANCH ON THE DERIVED STAGE, never the raw status — the rule the rest of
  // the codebase follows. Today the two coincide (no derived stages are left),
  // but the ancestor app's "Label Sent" funnel row read 0 forever because a
  // caller counted the raw status, and this is the line that remembers why.
  const statusCounts = { awaiting: 0, received: 0, paid: 0 };
  for (const s of inRange) {
    const stage = displayStage(s);
    if (stage in statusCounts) statusCounts[stage] += 1;
  }

  const paid = inRange.filter((s) => s.status === "paid");
  const paidTotal = sum(paid.map((s) => Number(s.paidAmount) || 0));
  const paidCount = paid.length;
  const ordersInPeriod = inRange.length;
  const avgPayout = paidCount ? paidTotal / paidCount : 0;
  const conversionRate = taken.length ? paidCount / taken.length : 0;

  // --- Customers (in period) -------------------------------------------------
  const byPhone = new Map();
  for (const s of inRange) {
    const cur = byPhone.get(s.phone) || { phone: s.phone, name: s.name, orders: 0, paid: 0 };
    cur.orders += 1;
    cur.paid += s.status === "paid" ? Number(s.paidAmount) || 0 : 0;
    byPhone.set(s.phone, cur);
  }
  const distinct = [...byPhone.values()];
  const repeatCustomers = distinct.filter((c) => c.orders > 1).length;
  const repeatRate = distinct.length ? repeatCustomers / distinct.length : 0;
  const newLeads = customers.filter((c) => c.firstSeen >= from && c.firstSeen <= to).length;

  const topCustomers = distinct
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 5)
    .map((c) => ({ name: c.name, phone: c.phone, totalPaid: c.paid, orders: c.orders }));

  // --- Breakdowns (in period) -----------------------------------------------
  const methodMap = new Map();
  for (const s of paid) {
    const m = s.paymentMethod || "Other";
    const cur = methodMap.get(m) || { method: m, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(s.paidAmount) || 0;
    methodMap.set(m, cur);
  }
  const paymentMethods = [...methodMap.values()].sort((a, b) => b.amount - a.amount);
  // One stored type, two useful buckets: did they book, or just turn up?
  // That is the split ad spend actually cares about — booked meetups are what
  // the ads produce, walk-ins are the sign and the word of mouth.
  const orderTypeSplit = {
    meetups: inRange.filter((s) => !(s.walkIn === true || s.walk_in === true)).length,
    walkIns: inRange.filter((s) => s.walkIn === true || s.walk_in === true).length,
  };

  // --- Trend (adaptive buckets across the window) ---------------------------
  const trend = buildTrend(inRange, from, to);

  // --- Current state (always now) -------------------------------------------
  const current = {
    totalCustomers: customers.length,
    openOrders: shipments.filter(isOpen).length,
    followUps: shipments.filter(needsFollowUp).length,
    waitingReplies: customers.filter((c) => (c.unreadCount || 0) > 0).length,
  };

  return {
    rangeLabel: label,
    newLeads,
    repeatCustomers,
    repeatRate,
    ordersInPeriod,
    cancelledInPeriod,
    paidTotal,
    paidCount,
    avgPayout,
    conversionRate,
    statusCounts,
    trend,
    topCustomers,
    paymentMethods,
    orderTypeSplit,
    current,
  };
}

/** Pipeline stages in lifecycle order, for rendering the funnel. */
export const PIPELINE = STAGES.map((s) => s.key);

/* ---------------- trend bucketing ---------------- */

function buildTrend(shipments, from, to) {
  const span = to - Math.max(from, earliest(shipments) ?? to);
  const unit = span > 0 && span <= 70 * DAY ? "week" : "month";
  const cap = 12;

  // Build buckets ending at `to`, walking back, bounded by `from` and the cap.
  const buckets = [];
  let cursor = unit === "week" ? weekStartMs(to) : startOfMonth(to).getTime();
  const lowerBound = from > 0 ? from : (earliest(shipments) ?? cursor);
  while (buckets.length < cap && cursor >= startOfBucket(lowerBound, unit)) {
    buckets.unshift({ start: cursor, label: bucketLabel(cursor, unit), count: 0, paid: 0 });
    // Re-normalised onto the week grid, not just stepped back 7×86400000ms.
    // Orders are matched to a bucket by EXACT start-of-week equality below, so
    // once the cursor drifts by an hour across a DST change every earlier
    // bucket matches nothing — two thirds of a range spanning November
    // rendered as empty weeks.
    cursor = unit === "week" ? weekStartMs(cursor - 7 * DAY) : addMonths(cursor, -1).getTime();
  }
  if (buckets.length === 0)
    buckets.push({ start: cursor, label: bucketLabel(cursor, unit), count: 0, paid: 0 });

  for (const s of shipments) {
    const b = startOfBucket(s.createdAt, unit);
    const hit = buckets.find((x) => x.start === b);
    if (hit) {
      hit.count += 1;
      if (s.status === "paid") hit.paid += Number(s.paidAmount) || 0;
    }
  }
  return { unit, buckets };
}

/* ---------------- date helpers ---------------- */

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const earliest = (arr) => (arr.length ? Math.min(...arr.map((s) => s.createdAt)) : null);

// Everything in this file thinks in ms timestamps; dates.js hands back Dates.
// These shims keep the bucket-walk arithmetic below readable.
function startOfBucket(ms, unit) {
  return unit === "week" ? weekStartMs(ms) : startOfMonth(ms).getTime();
}
function weekStartMs(ms) {
  return startOfWeek(ms).getTime();
}
function bucketLabel(ms, unit) {
  return unit === "week"
    ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : new Date(ms).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
