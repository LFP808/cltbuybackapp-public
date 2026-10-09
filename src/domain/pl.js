import { lotCogTotal, isDirectSale } from "./inventory";
import { inRange } from "./date-range";
import { isOwnerDraw } from "./expenses";

/**
 * The whole business, in one number.
 *
 * Until now the money lived in three places that never met: the dashboard
 * counted payouts to customers (money OUT, with no revenue beside it),
 * /invoices and /inventory knew what buyers paid and what the boxes cost, and
 * /expenses was a ledger nothing read. No screen answered "did we make money
 * this month", so nobody could.
 *
 * WHAT COUNTS, AND WHEN. Each figure is dated by the event that made it real:
 *
 *   revenue  — what buyers actually PAID, dated at settlement. Never projected:
 *              a shipped invoice is a hope, and this file follows the same rule
 *              as domain/inventory.js — "a projection shown as profit is how a
 *              spreadsheet lies to you".
 *   cog      — what we paid the customer for the boxes ON those settled
 *              invoices, so cost lands in the same period as the sale it
 *              produced. NOT total payouts in the window: buying $5k of stock
 *              in September and selling it in October is not a September loss.
 *   shipping — what it cost to ship those invoices to the buyer.
 *   expenses — the running costs of the business, dated by the day they were
 *              spent (ads, payroll, packing).
 *
 * net = revenue - cog - shipping - expenses - disposals.
 *
 * Disposals are subtracted after gross profit rather than inside it: gross
 * profit is margin on what SOLD (revenue - cog - shipping), and a disposal is
 * a period cost dated by its own event, not by a sale. A written-off device
 * never reaches an invoice.
 */

/**
 * @param {object} input
 * @param {object[]} input.invoices  with `lots` embedded
 * @param {object[]} input.lots      every lot, for disposals
 * @param {object[]} input.expenses
 * @param {object[]} input.orders    accepted for call-site compatibility; unused
 * @param {{from: number, to: number}} input.range
 */
export function computePL({ invoices = [], lots = [], expenses = [], orders = [], range }) {
  const settled = invoices.filter(
    (inv) =>
      inv.status === "complete" && inv.paid != null && inRange(inv.paidAt ?? inv.createdAt, range),
  );

  // Direct-channel sales (eBay): revenue with no invoice, dated by sold_at —
  // the same "when the money became real" rule the settled filter applies.
  const direct = lots.filter((lot) => isDirectSale(lot) && inRange(lot.soldAt ?? lot.createdAt, range));

  const revenue = round(
    settled.reduce((sum, inv) => sum + (Number(inv.paid) || 0), 0) +
      direct.reduce((sum, lot) => sum + (Number(lot.soldTotal) || 0), 0),
  );
  const shipping = round(
    settled.reduce((sum, inv) => sum + (Number(inv.shipping) || 0), 0) +
      direct.reduce((sum, lot) => sum + (Number(lot.shipTotal) || 0), 0),
  );
  const cog = round(
    settled.reduce(
      (sum, inv) => sum + (inv.lots || []).reduce((s, lot) => s + lotCogTotal(lot), 0),
      0,
    ) + direct.reduce((sum, lot) => sum + lotCogTotal(lot), 0),
  );
  // Marketplace fees. Summed from BOTH kinds of sold lot on purpose — invoice
  // lots carry no fees today, but if a fee ever lands on one the statement
  // must not lose it.
  const fees = round(
    settled.reduce(
      (sum, inv) => sum + (inv.lots || []).reduce((s, lot) => s + (Number(lot.feeTotal) || 0), 0),
      0,
    ) + direct.reduce((sum, lot) => sum + (Number(lot.feeTotal) || 0), 0),
  );

  // Written off in this window. Dated by disposal, not by check-in: that is
  // when the loss was taken.
  const disposed = lots.filter(
    (lot) => lot.status === "disposed" && lot.disposedAt && inRange(lot.disposedAt, range),
  );
  const disposals = round(disposed.reduce((sum, lot) => sum + lotCogTotal(lot), 0));

  // Owner draws live in the same ledger but are NOT a cost: taking profit out
  // doesn't make the month less profitable, it just moves where the profit
  // sits. Counted in domain/cash.js against the business-money pot instead.
  const inWindow = expenses.filter(
    (e) => !isOwnerDraw(e) && inRange(dayMs(e.spentOn) ?? e.createdAt, range),
  );
  const expenseTotal = round(inWindow.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));

  const grossProfit = round(revenue - cog - shipping - fees);
  const net = round(grossProfit - expenseTotal - disposals);

  return {
    revenue,
    cog,
    shipping,
    fees,
    disposals,
    expenses: expenseTotal,
    grossProfit,
    net,
    invoiceCount: settled.length,
    directCount: direct.length,
    // Margin on what was sold, before operating costs — the number that says
    // whether the buying and selling itself works. Null rather than 0 when
    // nothing sold, so the UI can say "no sales" instead of "0%".
    margin: revenue > 0 ? grossProfit / revenue : null,
    expensesByCategory: byCategory(inWindow),
  };
}

/**
 * Realized profit per buyer-person — who did the buy, from lot.boughtBy
 * (stamped from the login at Mark bought / walk-in creation).
 *
 * Same recognition rules as computePL, applied per lot: a device counts when
 * its invoice SETTLED (profit = sold − cog − its shipping share, which is why
 * the per-lot figures sum to the statement's gross profit), and a disposal
 * counts as −cog dated by the disposal. Operating expenses are not split —
 * they belong to the business, not to whoever bought a given phone.
 *
 * Lots that predate the column group under "Unrecorded"; the caller decides
 * whether a rollup that is ALL Unrecorded is worth showing.
 */
export function plByBuyer({ invoices = [], lots = [], range }) {
  const map = new Map();
  const bucket = (name) => {
    const key = name || "Unrecorded";
    if (!map.has(key)) map.set(key, { name: key, units: 0, disposals: 0, profit: 0 });
    return map.get(key);
  };

  const lotProfit = (lot) =>
    (Number(lot.soldTotal) || 0) -
    lotCogTotal(lot) -
    (Number(lot.shipTotal) || 0) -
    (Number(lot.feeTotal) || 0);

  for (const inv of invoices) {
    if (inv.status !== "complete" || inv.paid == null) continue;
    if (!inRange(inv.paidAt ?? inv.createdAt, range)) continue;
    for (const lot of inv.lots || []) {
      const b = bucket(lot.boughtBy);
      b.units += 1;
      b.profit += lotProfit(lot);
    }
  }
  for (const lot of lots) {
    // Direct-channel sales, dated like computePL dates them.
    if (isDirectSale(lot) && inRange(lot.soldAt ?? lot.createdAt, range)) {
      const b = bucket(lot.boughtBy);
      b.units += 1;
      b.profit += lotProfit(lot);
      continue;
    }
    if (lot.status !== "disposed" || !lot.disposedAt || !inRange(lot.disposedAt, range)) continue;
    const b = bucket(lot.boughtBy);
    b.disposals += 1;
    b.profit -= lotCogTotal(lot);
  }

  return [...map.values()]
    .map((b) => ({ ...b, profit: round(b.profit) }))
    .sort((a, b) => b.profit - a.profit);
}

/** Per-category expense totals, biggest first. */
function byCategory(expenses) {
  const map = new Map();
  for (const e of expenses) {
    map.set(e.category, (map.get(e.category) || 0) + (Number(e.amount) || 0));
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: round(total) }))
    .sort((a, b) => b.total - a.total);
}

/** YYYY-MM-DD -> ms at local midnight, or null. */
function dayMs(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
