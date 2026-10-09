"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { currency } from "@/domain/format";
import { invoiceNumber, invoicePL, unitCount, buildCsv } from "@/domain/inventory";
import { startOfMonth } from "@/domain/dates";

const STATUS_TONES = {
  shipped: "bg-status-sent-bg text-status-sent",
  complete: "bg-status-paid-bg text-status-paid",
  voided: "bg-bg text-muted ring-1 ring-inset ring-line",
};

// Stored "shipped" reads "Sent" — most sales are local handovers, and the
// state means "the document went to the buyer", not "a box left". Same call
// as LOT_STATUS_LABELS' "On Invoice".
const STATUS_LABELS = { shipped: "Sent", complete: "Settled", voided: "Voided" };

/**
 * Every invoice, newest number first, with the three numbers that run the
 * money side: what's outstanding, what cleared this month, and what this
 * month actually earned after COG and shipping.
 */
export function InvoicesList({ invoices }) {
  const tiles = useMemo(() => {
    const monthStart = startOfMonth(new Date()).getTime();
    let outstanding = 0;
    let outstandingCount = 0;
    let paidMonth = 0;
    let paidCount = 0;
    let plMonth = 0;
    for (const inv of invoices) {
      if (inv.status === "shipped") {
        outstanding += inv.projected;
        outstandingCount += 1;
      }
      if (inv.status === "complete" && (inv.paidAt ?? inv.createdAt) >= monthStart) {
        paidMonth += inv.paid || 0;
        paidCount += 1;
        plMonth += invoicePL(inv) || 0;
      }
    }
    return { outstanding, outstandingCount, paidMonth, paidCount, plMonth };
  }, [invoices]);

  function exportCsv() {
    const csv = buildCsv(
      ["Invoice", "Buyer", "Date", "Units", "Projected", "Paid", "P/L", "Status"],
      invoices.map((inv) => {
        const pl = invoicePL(inv);
        return [
          invoiceNumber(inv.number),
          inv.buyer?.name || "",
          new Date(inv.createdAt).toLocaleDateString(),
          unitCount(inv.lots || []),
          inv.projected.toFixed(2),
          inv.paid != null ? inv.paid.toFixed(2) : "",
          pl != null ? pl.toFixed(2) : "",
          STATUS_LABELS[inv.status] || inv.status,
        ];
      }),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "invoices.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile
          label="Outstanding"
          value={currency(tiles.outstanding)}
          sub={`${tiles.outstandingCount} invoice${tiles.outstandingCount === 1 ? "" : "s"} sent`}
        />
        <Tile
          label="Paid this month"
          value={currency(tiles.paidMonth)}
          sub={`${tiles.paidCount} settled`}
        />
        <Tile
          label="P/L this month"
          value={(tiles.plMonth > 0 ? "+" : "") + currency(tiles.plMonth)}
          sub="after COG and shipping"
          tone={tiles.plMonth < 0 ? "text-destructive" : "text-cash"}
        />
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Build one from in-stock inventory — it ships the lots and tracks the payout."
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[700px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                  <th className="px-4 py-2.5">Invoice</th>
                  <th className="px-3 py-2.5">Buyer</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5 text-center">Units</th>
                  <th className="px-3 py-2.5 text-right">Projected</th>
                  <th className="px-3 py-2.5 text-right">Paid</th>
                  <th className="px-3 py-2.5 text-right">P/L</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const pl = invoicePL(inv);
                  const voided = inv.status === "voided";
                  return (
                    <tr
                      key={inv.id}
                      className={cn(
                        "border-b border-line/60 last:border-0 hover:bg-bg",
                        voided && "text-muted",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className={cn("text-accent hover:underline", voided && "line-through")}
                        >
                          {invoiceNumber(inv.number)}
                        </Link>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5">
                        {inv.buyer?.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-muted">
                        {new Date(inv.createdAt).toLocaleDateString(undefined, {
                          month: "2-digit",
                          day: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono tabular-nums">
                        {unitCount(inv.lots || [])}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums",
                          voided && "line-through",
                        )}
                      >
                        {currency(inv.projected)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                        {inv.paid != null ? currency(inv.paid) : "—"}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold tabular-nums",
                          pl == null
                            ? "text-muted"
                            : pl < 0
                              ? "text-destructive"
                              : "text-status-received",
                        )}
                      >
                        {pl != null ? `${pl > 0 ? "+" : ""}${currency(pl)}` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex rounded-pill px-2 py-0.5 text-[10.5px] font-semibold",
                            STATUS_TONES[inv.status],
                          )}
                        >
                          {STATUS_LABELS[inv.status] || inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <button
            type="button"
            onClick={exportCsv}
            className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:underline"
          >
            <Download size={12} /> Export CSV
          </button>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-2.5 shadow-xs">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cn("text-[17px] font-bold tabular-nums text-ink", tone)}>{value}</div>
      <div className="text-[10.5px] text-muted">{sub}</div>
    </div>
  );
}
