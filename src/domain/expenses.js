/**
 * The expense ledger — money that leaves the business OUTSIDE an order.
 *
 * Customer payouts and buyer-shipping already live on the records they belong
 * to; this covers everything else it costs to operate (ad spend, payroll,
 * packing supplies). Kept separate on purpose so P/L stays derived: the order
 * and invoice tables answer "what did the devices make", this answers "what
 * did running the operation cost".
 */

/**
 * The categories offered before any data exists. Free text underneath — the
 * form also offers every category already used, the same shape as the item
 * catalog — so a new kind of cost never needs a deploy.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Advertising",
  "Payroll",
  "Packing & shipping",
  "Software",
  "Rent & utilities",
  "Fuel",
  "Other",
];

/** Defaults plus whatever the ledger already uses, defaults first, no dupes. */
export function expenseCategories(expenses = []) {
  const used = expenses.map((e) => e.category).filter(Boolean);
  return [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...used])];
}

/**
 * The category that records money Jaime takes OUT of the business — a draw,
 * not a cost (2026-08-08).
 *
 * An expense CATEGORY rather than its own table so recording one needs no
 * hand-run migration, at the price that every reader of the ledger must split
 * on it: P/L and the expense totals exclude draws (taking profit out is not a
 * cost of running the place), while the business-money pot in domain/cash.js
 * subtracts them from what sales brought in. Deliberately NOT in
 * DEFAULT_EXPENSE_CATEGORIES — the Money page's "Take money out" button is the
 * intended way in, and once one exists the picker offers it via `used` above.
 */
export const OWNER_DRAW_CATEGORY = "Owner draw";

/** Whether this entry is a draw rather than a cost. Tolerant of case/spacing —
 *  the category column is free text, and a hand-typed "owner draw" must not
 *  silently re-enter the cost totals. */
export function isOwnerDraw(expense) {
  return (
    String(expense?.category || "")
      .trim()
      .toLowerCase() === OWNER_DRAW_CATEGORY.toLowerCase()
  );
}

/** The ledger without draws — what running the place actually cost. */
export function operatingExpenses(expenses = []) {
  return expenses.filter((e) => !isOwnerDraw(e));
}

/** Just the draws — money taken out as profit. */
export function ownerDraws(expenses = []) {
  return expenses.filter(isOwnerDraw);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a new expense; returns a fieldErrors object, empty when clean. */
export function validateExpense({ spentOn, category, amount } = {}) {
  const errors = {};
  if (!DATE_RE.test(String(spentOn || ""))) errors.spentOn = "Pick the day the money was spent.";
  if (!String(category || "").trim()) errors.category = "Pick a category.";
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) errors.amount = "Enter the amount spent.";
  return errors;
}

/** Sum of a list of expenses, in dollars, rounded to the penny. */
export function expensesTotal(expenses) {
  return Math.round(expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) * 100) / 100;
}

/**
 * Per-category totals, largest first — the shape the summary renders. Sorted
 * by spend rather than name so the biggest cost is always the first line.
 */
export function totalsByCategory(expenses) {
  const map = new Map();
  for (const e of expenses) {
    map.set(e.category, (map.get(e.category) || 0) + (Number(e.amount) || 0));
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}
