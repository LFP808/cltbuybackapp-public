"use client";

import { Card, Input } from "@/components/ui";
import { PAYMENT_METHODS } from "@/domain/constants";
import { currency } from "@/domain/format";

/**
 * What we handed over, on the one order type that is already finished when it
 * is typed.
 *
 * Every other order reaches a payout through the order page, with the devices
 * counted first. A walk-in has none of that runway: the customer is at
 * the counter, the money moves, and the record has to be complete before they
 * are out of the door. So the payout is part of INTAKE here rather than a
 * later step, and the amount is required — an order that says "paid" with no
 * figure is a hole in the cash flow nothing downstream can distinguish from a
 * genuine $0.
 *
 * The seam is (payout, setPayout, total), the same shape as the other intake
 * cards: state stays in the form because submit needs it.
 */
export function WalkInPayout({
  payout,
  setPayout,
  total,
  touched,
  setTouched,
  fieldErrors = {},
  // Admin-set list from app_settings (see /settings); the constant is only
  // the fallback for a caller that didn't fetch it.
  paymentMethods = PAYMENT_METHODS,
}) {
  /**
   * The line-item total, until somebody says otherwise.
   *
   * A prefill is a suggestion, not a fact, and the moment anyone types the
   * suggestion stops updating underneath them. Without that, adding one more item after
   * agreeing a rounded-down cash figure would silently rewrite what you paid.
   */
  const amount = touched ? payout.amount : total ? String(total) : "";
  const cash = payout.method === "Cash";

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">Paid at the counter</span>
        {!touched && total > 0 && (
          <span className="text-[12px] text-muted">from the items — edit to change</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Amount paid *"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => {
            setTouched(true);
            setPayout((p) => ({ ...p, amount: e.target.value }));
          }}
          error={fieldErrors.paidAmount}
          placeholder="0.00"
        />
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">How *</span>
          <select
            value={payout.method}
            onChange={(e) => setPayout((p) => ({ ...p, method: e.target.value }))}
            className="h-9 rounded-lg border border-line bg-white px-3 text-[14px] text-ink shadow-xs"
          >
            {paymentMethods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {/* A stored method the admin has since removed stays pickable for
                THIS form's current value — otherwise the select renders blank
                while submitting the invisible old value. */}
            {payout.method && !paymentMethods.includes(payout.method) && (
              <option value={payout.method}>{payout.method}</option>
            )}
          </select>
          {fieldErrors.paymentMethod && (
            <span className="text-[12px] text-red-500">{fieldErrors.paymentMethod}</span>
          )}
        </label>
      </div>

      {/* Cash is the only method that moves paper money, and the float page
          counts on it being right — see isCashPayment in domain/cash.js. It is
          also the likeliest thing to happen at a counter, which is exactly why
          it is worth saying out loud rather than letting a default pass
          unread. */}
      <p className="text-[12px] text-muted">
        {cash
          ? `${currency(Number(amount) || 0)} comes out of the drawer and off the cash float.`
          : `Recorded as ${payout.method}, so the cash float is unaffected.`}
      </p>

      {/* The one thing this screen cannot know. Saying it here is what keeps
          "we paid for three phones and two turned up" a question somebody asks
          the same week, rather than a discrepancy found at month end. */}
      <p className="rounded-lg bg-accent-l px-3 py-2 text-[12.5px] text-accent-dark">
        Nothing has been counted yet — this lands in Pending Check-in, and if the count disagrees
        with what you paid, the check-in offers a correction.
      </p>
    </Card>
  );
}
