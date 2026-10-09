"use client";

import { Banknote } from "lucide-react";
import { Card } from "@/components/ui";
import { currency } from "@/domain/format";

/**
 * What to have in the drawer before the day's meetups start.
 *
 * Sits above the day view because it is a question with a deadline: it stops
 * being answerable once the first customer is at the counter. Deliberately
 * shows BOTH numbers — the suggestion and the amount that can never be short —
 * because a single figure would either be routinely too much cash on hand or
 * occasionally too little mid-handover, and only the person opening up knows
 * which risk they would rather take today.
 */
export function CashFloat({ float }) {
  if (!float) return null;

  const { stops, expected, share, suggested, worstCase } = float;
  const pct = share == null ? null : Math.round(share * 100);

  return (
    <Card className="mb-4" data-panel="float">
      <div className="flex items-start gap-2.5">
        <Banknote size={16} className="mt-0.5 flex-shrink-0 text-cash" />
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            Cash to carry
          </div>
          <div className="font-serif text-2xl text-ink" data-float="suggested">
            {currency(suggested)}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {stops} meetup{stops === 1 ? "" : "s"} today, {currency(expected)} expected
            {pct == null ? (
              <> — no payout history yet, so this is the full amount.</>
            ) : (
              <> — {pct}% of payouts have gone out in cash.</>
            )}
          </p>
          {suggested < worstCase && (
            <p className="mt-1 text-[11.5px] text-muted">
              <span data-float="worst">{currency(worstCase)}</span> covers every meetup paying cash.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
