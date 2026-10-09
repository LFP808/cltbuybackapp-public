"use client";

import { PLView } from "./PLView";
import { CashFlowView } from "./CashFlowView";

/**
 * The two money questions, on one page, in order.
 *
 * "Did we make money" and "is there money in the account" have different
 * answers in the same month. These used to live behind tabs so the two totals
 * could never be read as the same number — but in practice the tab hid the
 * cash story entirely (Jaime, 2026-08-08: "why does the P&L not reflect the
 * money I've sent out"). One scroll now tells the whole story; the guard
 * against conflating them is carried by the section headers and the blurbs
 * instead: P/L is dated by the sale, cash by the day money moved.
 *
 * P/L still leads because it is the question asked more often.
 */
export function MoneyTabs({
  orders,
  invoices,
  lots,
  expenses,
  // A read hit the paging backstop, so some rows are missing from the math.
  // Should never trip below ~50k rows — but if it does, these totals must not
  // present themselves as complete.
  truncated = false,
}) {
  return (
    <div>
      {truncated && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-[13px] text-red-600">
          <span className="font-semibold">These totals are incomplete.</span> The data outgrew what
          this page will load in one go, so some rows are missing from every figure below. Treat
          nothing here as final.
        </div>
      )}

      <h2 className="mb-1 text-[15px] font-semibold text-ink">Profit &amp; loss</h2>
      <p className="mb-4 text-[13px] italic text-muted">
        What buyers paid, minus what the devices cost us, minus what it costs to run the place.
        Sales count when the invoice is settled — never when it ships.
      </p>
      <PLView orders={orders} invoices={invoices} lots={lots} expenses={expenses} />

      <h2 className="mb-1 mt-8 border-t border-line pt-6 text-[15px] font-semibold text-ink">
        Cash flow
      </h2>
      <p className="mb-4 text-[13px] italic text-muted">
        Money that actually moved, on the day it moved. Buying is fronted personally for now - the
        business-money card is what the sales pot holds.
      </p>
      <CashFlowView orders={orders} invoices={invoices} lots={lots} expenses={expenses} />
    </div>
  );
}
