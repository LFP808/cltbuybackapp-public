import { isCashPayment } from "./cash";
import { dayKey } from "./dates";

/**
 * How much cash to have in the drawer before the day's meetups start.
 *
 * Cash on the spot is the pitch on every ad, and coming up short means the
 * buy cannot close: the devices are counted, the customer is standing there,
 * and the only options are an awkward IOU or a trip to the ATM mid-meetup.
 * Holding the whole day's value in notes is the other failure - that is a
 * lot of cash sitting out for no reason.
 *
 * WHAT THIS CAN AND CANNOT KNOW. The payment method is chosen AT the payout,
 * not before, so which of today's sellers will want cash is genuinely unknown
 * when the day starts. What IS known is how this business's payouts have
 * actually gone: `orders.payment_method` has recorded it on every completed
 * payout since 0001. So the estimate is the day's expected total scaled by the
 * share that has historically gone out in cash, and the full total is shown
 * beside it as the number that can never be short.
 *
 * It is called a SUGGESTION everywhere, because it is one. A day where three
 * cash regulars happen to line up will beat any average, which is exactly why
 * the worst case sits next to it rather than being hidden behind it.
 */

/** ATMs dispense twenties, so a suggestion of $237 helps nobody. */
const NOTE = 20;

/** How far back to read the cash-vs-bank habit. */
export const HISTORY_DAYS = 90;

/**
 * The share of payout money that went out as cash, over the recent past.
 *
 * Weighted by AMOUNT, not by count: ten $20 cash stops and one $2,000 transfer
 * is not a business that needs its float set by "eleven payouts, ten of them
 * cash". Returns null when there is nothing to learn from, which the caller
 * must handle rather than treating as zero — "no history" and "never pays
 * cash" lead to opposite advice.
 */
export function cashShare(orders = [], now = Date.now()) {
  const since = now - HISTORY_DAYS * 86400000;
  const paid = orders.filter(
    (o) => o.status === "paid" && Number(o.paidAmount) > 0 && (o.paidAt ?? o.createdAt) >= since,
  );
  if (!paid.length) return null;

  const total = paid.reduce((s, o) => s + Number(o.paidAmount), 0);
  if (total <= 0) return null;
  const cash = paid
    .filter((o) => isCashPayment(o.paymentMethod))
    .reduce((s, o) => s + Number(o.paidAmount), 0);
  return cash / total;
}

/**
 * What today's meetups are expected to cost, and how much to hold in notes.
 *
 * @param {object} input
 * @param {object[]} input.stops    orders with dates (the calendar set)
 * @param {object[]} input.history  completed orders, for the cash habit
 * @param {number}   [input.now]
 * @returns {{stops:number, expected:number, share:number|null, suggested:number, worstCase:number}|null}
 *          null when there is nothing to carry cash for
 */
export function cashFloat({ stops = [], history = [], now = Date.now() } = {}) {
  const today = dayKey(new Date(now));
  // Only visits that still have to be paid for. A meetup already marked paid
  // took its cash out of the drawer this morning, not this afternoon.
  const due = stops.filter(
    (o) => o.type === "office" && o.status === "awaiting" && o.pickupDate === today,
  );
  if (!due.length) return null;

  const expected = round(due.reduce((s, o) => s + (Number(o.estValue) || 0), 0));
  if (expected <= 0) return null;

  const share = cashShare(history, now);
  // With no history to go on, the only honest advice is the whole amount.
  const suggested = share == null ? roundUpTo(expected, NOTE) : roundUpTo(expected * share, NOTE);

  return {
    stops: due.length,
    expected,
    share,
    suggested: Math.min(suggested, roundUpTo(expected, NOTE)),
    worstCase: roundUpTo(expected, NOTE),
  };
}

/** Up to the next $20 — you cannot carry $7 of a twenty. */
function roundUpTo(n, step) {
  return Math.ceil((Number(n) || 0) / step) * step;
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
