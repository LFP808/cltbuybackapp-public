import { normPhone } from "./format";
import { ORDER_TYPES, isWalkIn } from "./orders";

/**
 * What makes an order valid.
 *
 * Pure, so the form and the server action apply exactly the same rules. That
 * matters more than it sounds: the form's checks are a courtesy — they stop
 * honest mistakes and give good error messages — while the action's are the
 * ones that actually hold, because a server action is a public endpoint that
 * anything can call.
 *
 * No address here: every order is a meetup at OUR place, so the customer's
 * address is not a fact the business needs. Name and phone are — the phone
 * is the thread, the reminders, and the way to say "running late".
 *
 * Returns a map of field -> message so the UI can put each error next to the
 * input it belongs to, rather than a single line at the bottom that makes
 * you hunt for what's wrong.
 */

/** A US mobile/landline we can actually text. */
export function validatePhone(value) {
  const digits = normPhone(value);
  if (digits.length === 0) return "Phone is required.";
  if (digits.length !== 10) return "Enter a 10-digit US phone number.";
  // Area codes and exchanges never start with 0 or 1; catches transposed digits
  // and half-typed numbers that would otherwise be stored and never reachable.
  if (/^[01]/.test(digits)) return "That doesn't look like a valid area code.";
  return null;
}

/**
 * Validate a whole order at intake.
 *
 * @param {object} input the form/action payload
 * @returns {Record<string,string>} field -> message; empty means valid
 */
export function validateNewOrder(input) {
  const errors = {};

  if (!String(input?.name || "").trim()) errors.name = "Customer name is required.";

  const phoneError = validatePhone(input?.phone);
  if (phoneError) errors.phone = phoneError;

  if (input?.type && !ORDER_TYPES.includes(input.type)) {
    errors.type = "Unknown order type.";
  }

  // A CONDITION ON EVERY LINE OF A BOOKING (Jaime, 2026-10-02). The VA asks
  // "what shape is it in?" on the call anyway; writing the answer down is
  // what lets the price quoted on the phone be compared with the device on
  // the counter, and it pre-seeds the grade at check-in. Picked from the
  // grades ladder (the `grades` setting), never typed free — "good" and "B"
  // must not be two conditions. A walk-in is exempt: the device is in hand
  // and check-in grades it minutes later, so asking twice is just friction.
  if (!isWalkIn(input)) {
    const items = Array.isArray(input?.items) ? input.items : [];
    const missing = items.filter((it) => !String(it?.condition ?? "").trim());
    if (missing.length) {
      errors.items =
        missing.length === 1
          ? `Pick a condition for ${missing[0]?.name || "the item"}.`
          : `Pick a condition for each item (${missing.length} missing).`;
    }
  }

  // A WALK-IN CARRIES ITS OWN PAYOUT, because it is created after the money
  // has already changed hands. The rest of the app reaches "paid" through
  // advanceOrderAction, which has its own money gate; this is the only path
  // that writes a payout at intake, so the amount is required rather than
  // optional-and-filled-in-later. An order that says "paid" with no figure is
  // a hole in the cash flow that nothing downstream can tell from a $0 payout.
  if (isWalkIn(input)) {
    const raw = input.paidAmount;
    const amount = Number(raw);
    if (raw === "" || raw == null || !Number.isFinite(amount) || amount < 0) {
      errors.paidAmount = "Enter what you paid them.";
    } else if (amount > 0 && !String(input.paymentMethod || "").trim()) {
      // Only when money actually moved. A $0 walk-in — they brought devices
      // we couldn't buy, and we logged the visit — has no method to name.
      errors.paymentMethod = "Choose how they were paid.";
    }
  }

  return errors;
}

/** Convenience: a single sentence summarising a field-error map. */
export function firstError(errors) {
  const keys = Object.keys(errors || {});
  return keys.length ? errors[keys[0]] : null;
}
