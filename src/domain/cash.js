import { inRange } from "./date-range";
import { isOwnerDraw } from "./expenses";
import { isDirectSale } from "./inventory";

/**
 * Cash flow — what LEFT and ENTERED the business, on the day it moved.
 *
 * The sibling of domain/pl.js, and deliberately a different answer. P/L asks
 * whether the trade works: revenue counts at settlement and the cost of the
 * boxes lands in the same period as the sale it produced, so a good month reads
 * as a good month. That is right, and it is not the bank.
 *
 * Buying $5k of stock in September and selling it in October is not a September
 * loss — but the account WAS $5k lighter in September, and payroll came out of
 * that account. A business can be profitable on paper and still not make rent.
 * This file is the second story: money, on the day it moved, whatever it was
 * for.
 *
 * WHAT COUNTS AS MOVEMENT. Everything the app already records, dated by the
 * event that spent or earned it:
 *
 *   in   buyer settlements   — what a buyer actually paid, at paidAt
 *   out  customer payouts    — what we handed over, at payoutAt (see below)
 *   out  shipping to buyers  — what it cost to send an invoice's boxes out
 *   out  operating expenses  — the /expenses ledger, at spentOn
 *   out  owner draws         — profit Jaime takes out, recorded as an expense
 *                              in the OWNER_DRAW_CATEGORY (see fundingSummary)
 *
 * THE PERSONAL-FUNDING PHASE (Jaime, 2026-08-08). Until the business has its
 * own account, every cost above comes out of his pocket: the business's actual
 * money is what buyers have paid MINUS what he has drawn out — fundingSummary
 * below. The movements ledger still records every cost (it is the truth of
 * what moved and what P/L needs), but the balance story changed: the counted
 * balance / reconcile flow (expectedBalance, reconcile, snapshots — migration
 * 0022) is PARKED, not deleted, because there is no single account whose
 * total the expected figure should match. It comes back the day the business
 * account opens: count it once and the anchor is real again.
 *
 * WHAT IT CANNOT SEE, and why the balance below is called EXPECTED: a cash
 * purchase nobody logged, a bank fee, a transfer to a personal account. The
 * gap between this and a counted balance is exactly that unrecorded spending —
 * which is the reason to show the gap rather than hide it.
 */

/** The one payment method that moves paper money. Everything else hits a bank. */
const CASH_METHOD = "Cash";

/**
 * When a payout actually left.
 *
 * Prefers the `paid_at` column (migration 0022) and falls back to the activity
 * log, which has recorded {action: 'Marked paid', at} on every transition since
 * long before the column existed. Reading it this way means cash flow is
 * correct whether or not 0022 has been applied yet — migrations here are run by
 * hand, and a screen that lies until someone remembers to run one is worse than
 * a screen that is merely less exact.
 *
 * createdAt is the last resort: an order that was paid belongs in the totals
 * even if nothing recorded the day, and being a few days out beats vanishing.
 */
export function payoutAt(order) {
  return order?.paidAt ?? activityAt(order, "Marked paid") ?? order?.createdAt ?? null;
}

/** When the devices arrived — the buy happening, whatever the log says. */
export function receivedAt(order) {
  if (order?.receivedAt) return order.receivedAt;
  const logged = activityAt(order, "Marked received");
  if (logged) return logged;
  // Checked in means it physically got here, whatever the log says.
  return order?.checkedInAt ?? null;
}

/** The last time `action` was recorded, or null. Corrections mean the LAST wins. */
function activityAt(order, action) {
  // startsWith, not equality: the writer now appends detail to the action
  // ("Marked paid $140 via Zelle"), which an exact match on "Marked paid"
  // never hits — the fallback this exists to be was dead code. Safe because
  // no other action shares these prefixes (a correction writes "Payout
  // corrected ...", not "Marked paid ...").
  const hits = (order?.activity || []).filter(
    (e) => typeof e?.action === "string" && e.action.startsWith(action) && e?.at,
  );
  return hits.length ? Math.max(...hits.map((e) => Number(e.at))) : null;
}

/** Did this payout come out of the drawer rather than an account? */
export function isCashPayment(method) {
  return String(method || "").trim() === CASH_METHOD;
}

/**
 * Every movement in a window, as a flat list — the shape both the totals and
 * the running balance are built from, so the two can never disagree.
 *
 * @returns {Array<{at:number, amount:number, direction:'in'|'out', bucket:string, label:string}>}
 */
export function cashMovements({ orders = [], invoices = [], expenses = [], lots = [] }) {
  const moves = [];

  // Direct-channel sales (eBay). What lands in the bank is the payout NET of
  // the platform's fees — recording the gross here would claim money that was
  // never ours to hold. The label cost is its own OUT, like invoice postage.
  for (const lot of lots) {
    if (!isDirectSale(lot)) continue;
    const at = lot.soldAt ?? lot.createdAt;
    if (!at) continue;
    const net = (Number(lot.soldTotal) || 0) - (Number(lot.feeTotal) || 0);
    if (net > 0) {
      moves.push({
        at,
        amount: net,
        direction: "in",
        bucket: "direct_sales",
        label: `${lot.soldChannel || "Direct"} - ${lot.item}`,
      });
    }
    if (Number(lot.shipTotal) > 0) {
      moves.push({
        at,
        amount: Number(lot.shipTotal),
        direction: "out",
        bucket: "shipping",
        label: `Shipping - ${lot.soldChannel || "direct"} sale`,
      });
    }
  }

  for (const order of orders) {
    if (order.status === "paid" && Number(order.paidAmount) > 0) {
      const at = payoutAt(order);
      if (at) {
        moves.push({
          at,
          amount: Number(order.paidAmount),
          direction: "out",
          bucket: "payouts",
          label: order.name || "Customer payout",
          cash: isCashPayment(order.paymentMethod),
          method: order.paymentMethod || "Other",
        });
      }
    }
  }

  for (const inv of invoices) {
    if (inv.status === "complete" && inv.paid != null) {
      const at = inv.paidAt ?? inv.createdAt;
      if (at) {
        moves.push({
          at,
          amount: Number(inv.paid),
          direction: "in",
          bucket: "settlements",
          label: `Invoice ${inv.number}${inv.buyer?.name ? ` - ${inv.buyer.name}` : ""}`,
        });
      }
    }
    // A voided invoice's boxes went back on the shelf and were never sent, so
    // its shipping was never bought. Dated at creation, which is when the
    // invoice shipped — that is the moment the postage was paid for.
    if (inv.status !== "voided" && Number(inv.shipping) > 0) {
      moves.push({
        at: inv.createdAt,
        amount: Number(inv.shipping),
        direction: "out",
        bucket: "shipping",
        label: `Shipping - invoice ${inv.number}`,
      });
    }
  }

  for (const e of expenses) {
    const at = dayMs(e.spentOn) ?? e.createdAt;
    if (at && Number(e.amount) > 0) {
      // A draw is its own bucket, not an operating cost: the same split every
      // reader of the ledger makes (see OWNER_DRAW_CATEGORY in expenses.js).
      const draw = isOwnerDraw(e);
      moves.push({
        at,
        amount: Number(e.amount),
        direction: "out",
        bucket: draw ? "draws" : "expenses",
        label: draw
          ? e.note || "Owner draw"
          : e.vendor
            ? `${e.category} - ${e.vendor}`
            : e.category,
      });
    }
  }

  return moves.sort((a, b) => a.at - b.at);
}

const IN_BUCKETS = [
  { key: "settlements", label: "Buyer settlements", hint: "what buyers paid" },
  { key: "direct_sales", label: "eBay sales", hint: "payouts net of fees" },
];

const OUT_BUCKETS = [
  { key: "payouts", label: "Customer payouts", hint: "what we paid for devices" },
  { key: "expenses", label: "Operating expenses", hint: "ads, payroll, packing" },
  { key: "shipping", label: "Shipping to buyers", hint: "postage on invoices sent" },
  { key: "draws", label: "Owner draws", hint: "profit taken out" },
];

/**
 * Money in and out for a window, bucketed.
 *
 * @param {{orders?:object[], invoices?:object[], expenses?:object[], range:{from:number,to:number}}} input
 */
export function computeCashFlow({ orders = [], invoices = [], expenses = [], lots = [], range }) {
  const moves = cashMovements({ orders, invoices, expenses, lots }).filter((m) =>
    inRange(m.at, range),
  );

  const total = (direction, bucket) =>
    round(
      moves
        .filter((m) => m.direction === direction && m.bucket === bucket)
        .reduce((s, m) => s + m.amount, 0),
    );

  const inflow = IN_BUCKETS.map((b) => ({ ...b, amount: total("in", b.key) }));
  const outflow = OUT_BUCKETS.map((b) => ({ ...b, amount: total("out", b.key) }));

  const totalIn = round(inflow.reduce((s, b) => s + b.amount, 0));
  const totalOut = round(outflow.reduce((s, b) => s + b.amount, 0));

  // How the payouts were made. Does not change the total by a penny — both
  // pools are the same money — but it answers "how much has to be in the
  // drawer", which is the question the day's cash float depends on.
  const methodMap = new Map();
  for (const m of moves.filter((x) => x.bucket === "payouts")) {
    const cur = methodMap.get(m.method) || { method: m.method, amount: 0, count: 0, cash: m.cash };
    cur.amount += m.amount;
    cur.count += 1;
    methodMap.set(m.method, cur);
  }
  const byMethod = [...methodMap.values()]
    .map((m) => ({ ...m, amount: round(m.amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    inflow,
    outflow,
    totalIn,
    totalOut,
    net: round(totalIn - totalOut),
    movementCount: moves.length,
    byMethod,
    cashOut: round(byMethod.filter((m) => m.cash).reduce((s, m) => s + m.amount, 0)),
  };
}

/* ---------------- business money (the pot) ---------------- */

/**
 * What the business actually holds, and what Jaime has covered from his own
 * pocket — the personal-funding phase's whole balance story (2026-08-08).
 *
 *   balance  = buyer settlements − owner draws. All-time, no anchor: unlike
 *              the parked expectedBalance below, every input is a recorded
 *              event, so there is nothing to count and nothing to drift.
 *   covered  = every cost so far (payouts, shipping, operating expenses) —
 *              money that came out of his pocket, shown so "what has this
 *              cost me personally" has an answer on screen.
 *
 * Built on cashMovements rather than re-deriving from rows so the pot and the
 * cash-flow tab can never disagree about what a settlement or a draw is.
 */
export function fundingSummary({ orders = [], invoices = [], expenses = [], lots = [] }) {
  const moves = cashMovements({ orders, invoices, expenses, lots });
  const sum = (pred) => round(moves.filter(pred).reduce((s, m) => s + m.amount, 0));
  // Both kinds of sale money: buyer settlements and direct-channel payouts.
  const sales = sum((m) => m.bucket === "settlements" || m.bucket === "direct_sales");
  const draws = sum((m) => m.bucket === "draws");
  const covered = sum((m) => m.direction === "out" && m.bucket !== "draws");
  return { sales, draws, covered, balance: round(sales - draws) };
}

/* ---------------- running balance (PARKED while personally funded) -------- */

/** A snapshot's two pools as the one number the balance rolls forward from. */
export function snapshotTotal(snapshot) {
  if (!snapshot) return null;
  return round((Number(snapshot.bank) || 0) + (Number(snapshot.cash) || 0));
}

/**
 * What should be there now, given the last counted balance.
 *
 * THE SNAPSHOT IS END-OF-DAY. Movement counts from the day AFTER `asOf`, which
 * matters more than it looks: someone reconciling at 5pm has already paid three
 * customers today, and those payouts are inside the balance they just read off
 * the bank. Counting the same day again would subtract them twice and the
 * number would be wrong the instant it was set — the one moment it most needs
 * to be right.
 *
 * Returns null with no snapshot: an expected balance with no anchor is a guess
 * wearing a dollar sign, and the UI says "not set up" instead.
 */
export function expectedBalance({
  snapshot,
  orders = [],
  invoices = [],
  expenses = [],
  now = Date.now(),
}) {
  const opening = snapshotTotal(snapshot);
  if (opening == null) return null;

  const from = dayAfter(snapshot.asOf);
  if (from == null) return null;

  const since = cashMovements({ orders, invoices, expenses }).filter(
    (m) => m.at >= from && m.at <= now,
  );
  const movement = round(
    since.reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0),
  );

  return {
    opening,
    movement,
    expected: round(opening + movement),
    since: snapshot.asOf,
    // Nobody trusts a number without knowing how old its anchor is, and a
    // six-week-old one deserves less trust than yesterday's.
    daysSince: Math.max(0, Math.floor((now - from) / 86400000) + 1),
    movementCount: since.length,
  };
}

/**
 * Compare a fresh count against what the app expected.
 *
 * `unaccounted` is the whole point: money that moved without being recorded.
 * Negative means more went out than the app knows about — an unlogged expense,
 * a cash purchase, a bank fee. Positive means money arrived from somewhere the
 * app never saw. Neither is an error to suppress; both are a prompt to go and
 * find out which.
 */
export function reconcile({ expected, bank, cash }) {
  const actual = round((Number(bank) || 0) + (Number(cash) || 0));
  if (expected == null) return { actual, expected: null, unaccounted: null };
  return { actual, expected: round(expected), unaccounted: round(actual - expected) };
}

/** How stale an anchor is allowed to get before the UI stops vouching for it. */
export const STALE_AFTER_DAYS = 45;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a counted balance; returns a fieldErrors object, empty when clean.
 *
 * A negative BANK figure is allowed — accounts do go overdrawn, and refusing to
 * record it would mean the one month you most need the number is the month you
 * cannot enter. Negative CASH is not: a drawer cannot hold less than nothing,
 * so that is a typo every time.
 */
export function validateSnapshot({ asOf, bank, cash } = {}) {
  const errors = {};
  if (!DATE_RE.test(String(asOf || ""))) errors.asOf = "Pick the day you counted.";
  const b = Number(bank);
  const c = Number(cash);
  if (bank !== "" && bank != null && !Number.isFinite(b)) errors.bank = "Enter the bank balance.";
  if (!Number.isFinite(c) || c < 0) errors.cash = "Enter the cash on hand (0 if none).";
  return errors;
}

/* ---------------- dates ---------------- */

/** YYYY-MM-DD -> ms at local midnight, or null. */
function dayMs(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

/** First instant of the day after a YYYY-MM-DD, or null. */
function dayAfter(value) {
  const ms = dayMs(value);
  if (ms == null) return null;
  const d = new Date(ms);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
