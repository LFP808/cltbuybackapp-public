"use client";

import { AlertTriangle, UserCheck, ArrowRight } from "lucide-react";

/**
 * What we already know about the phone number just typed.
 *
 * An open order is a warning — a second one for the same visit never closes;
 * a past order is just a familiar face. Purely presentational: the lookup and
 * the name-fill decision stay in the form, which is what lets this move out
 * without touching that wiring.
 */
export function KnownCustomerNotice({ known }) {
  return (
    <div
      className={
        known.openOrders.length > 0
          ? "rounded-lg border border-status-awaiting/40 bg-status-awaiting-bg/50 p-3"
          : "rounded-lg border border-line bg-bg p-3"
      }
    >
      {known.openOrders.length > 0 ? (
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-status-awaiting" />
          <div className="min-w-0 text-[12.5px]">
            <p className="font-semibold text-status-awaiting">
              {known.name} already has {known.openOrders.length} open order
              {known.openOrders.length === 1 ? "" : "s"}.
            </p>
            <p className="mt-0.5 text-muted">
              Check it isn&apos;t the same devices before creating another.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {known.openOrders.slice(0, 3).map((o) => (
                <a
                  key={o.id}
                  href={`/orders/${o.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-accent underline"
                >
                  View meetup
                  <ArrowRight size={11} />
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <UserCheck size={15} className="mt-0.5 flex-shrink-0 text-accent" />
          <div className="min-w-0 text-[12.5px]">
            <p className="font-semibold text-ink">
              Returning customer — {known.name}, {known.orderCount} previous order
              {known.orderCount === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
