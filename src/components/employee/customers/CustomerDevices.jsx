"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";
import { Card, SectionLabel } from "@/components/ui";
import { currency } from "@/domain/format";
import { lotCogTotal } from "@/domain/inventory";

/**
 * Devices bought from this customer, one row per device — grade and what we
 * actually paid. This is the dynamic-pricing receipt: what Doris got for her
 * iPhone last time, and what condition her devices tend to arrive in, one
 * glance before quoting her again.
 */
export function CustomerDevices({ lots }) {
  if (!lots?.length) return null;

  const units = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const paid = lots.reduce((sum, lot) => sum + lotCogTotal(lot), 0);

  return (
    <div className="min-w-0">
      <SectionLabel icon={Smartphone}>Devices from this customer</SectionLabel>
      <Card className="p-0">
        <p className="border-b border-line px-3.5 py-2 text-[11.5px] text-muted">
          {units} device{units === 1 ? "" : "s"} ·{" "}
          <span className="font-mono">{currency(paid)}</span> paid all-time
        </p>
        <div className="max-h-64 divide-y divide-line/60 overflow-y-auto">
          {lots.map((lot) => (
            <Link
              key={lot.id}
              href={`/orders/${lot.orderId}`}
              className="flex items-center gap-2 px-3.5 py-2 text-[12.5px] hover:bg-bg"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{lot.item}</span>
              {lot.grade && <span className="flex-shrink-0 text-muted">{lot.grade}</span>}
              {lot.imei && (
                <span className="hidden flex-shrink-0 font-mono text-[11px] text-muted sm:inline">
                  {lot.imei}
                </span>
              )}
              <span className="flex-shrink-0 font-mono tabular-nums text-muted">
                {currency(lotCogTotal(lot))}
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
