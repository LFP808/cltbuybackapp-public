"use client";

import { useMemo, useState } from "react";
import { Calendar, Download, TrendingUp, TrendingDown } from "lucide-react";
import { Card, Button, Modal } from "@/components/ui";
import { DateRangePicker } from "@/components/employee/dashboard/DateRangePicker";
import { resolveRange } from "@/domain/date-range";
import { computePL, plByBuyer } from "@/domain/pl";
import { buildCsv } from "@/domain/inventory";
import { currency } from "@/domain/format";
import { cn } from "@/lib/cn";

// Money arrives in monthly rhythms — buyer settlements, ad invoices, payroll —
// so a day view would mostly show zero and read as a broken page.
const PL_RANGES = ["month", "30d", "90d", "ytd", "all", "custom"];

/**
 * The P/L, for a period.
 *
 * Deliberately laid out as a statement rather than a wall of tiles: revenue at
 * the top, each cost subtracted beneath it, the net at the bottom in the one
 * place your eye lands. The arithmetic is visible so the number can be
 * argued with — a total nobody can check is a total nobody trusts.
 */
export function PLView({ orders, invoices, lots, expenses }) {
  const [rangeKey, setRangeKey] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

  const range = useMemo(
    () => resolveRange({ range: rangeKey, from: customFrom, to: customTo }),
    [rangeKey, customFrom, customTo],
  );
  const pl = useMemo(
    () => computePL({ orders, invoices, lots, expenses, range }),
    [orders, invoices, lots, expenses, range],
  );
  // Hidden while every lot predates the bought-by column — a table with one
  // "Unrecorded" row answers nothing.
  const byBuyer = useMemo(() => {
    const rows = plByBuyer({ invoices, lots, range });
    return rows.some((r) => r.name !== "Unrecorded") ? rows : [];
  }, [invoices, lots, range]);

  function exportExpenses() {
    const rows = expenses
      .filter((e) => {
        const [y, m, d] = String(e.spentOn || "")
          .split("-")
          .map(Number);
        const at = y && m && d ? new Date(y, m - 1, d).getTime() : e.createdAt;
        return at >= range.from && at <= range.to;
      })
      .map((e) => [e.spentOn, e.category, e.vendor || "", e.note || "", e.amount.toFixed(2)]);

    const csv = buildCsv(["Date", "Category", "Paid to", "Note", "Amount"], rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${range.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const positive = pl.net >= 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRangeOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-2 text-[12.5px] font-medium text-ink shadow-xs transition-colors hover:border-accent/40"
        >
          <Calendar size={13} className="text-accent" />
          {range.label}
        </button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={exportExpenses}>
          <Download size={14} /> Export expenses
        </Button>
      </div>

      <Modal open={rangeOpen} onClose={() => setRangeOpen(false)} title="Date range">
        <DateRangePicker
          value={rangeKey}
          onChange={setRangeKey}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
          allow={PL_RANGES}
        />
        <p className="mt-3 text-[12px] text-muted">
          Sales are dated by the day the buyer settled, expenses by the day they were spent.
        </p>
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <Button onClick={() => setRangeOpen(false)}>Done</Button>
        </div>
      </Modal>

      <Card className={cn("border-2", positive ? "border-cash/40 bg-cash-l/40" : "border-red-200")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              Net {positive ? "profit" : "loss"}
            </div>
            <div
              className={cn(
                "font-serif text-3xl",
                positive ? "text-cash" : "text-red-600",
              )}
            >
              {currency(pl.net)}
            </div>
          </div>
          {positive ? (
            <TrendingUp size={28} className="text-cash" />
          ) : (
            <TrendingDown size={28} className="text-red-500" />
          )}
        </div>
      </Card>

      <Card>
        <Line
          label="Revenue"
          hint={[
            `${pl.invoiceCount} settled invoice${pl.invoiceCount === 1 ? "" : "s"}`,
            pl.directCount > 0
              ? `${pl.directCount} eBay sale${pl.directCount === 1 ? "" : "s"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          value={pl.revenue}
        />
        <Line
          label="Cost of goods"
          hint="what we paid customers for those devices"
          value={-pl.cog}
        />
        <Line label="Shipping to buyers" value={-pl.shipping} />
        {/* Same manners as Written off: only when it happened. */}
        {pl.fees > 0 && (
          <Line label="Selling fees" hint="eBay final value and ad fees" value={-pl.fees} />
        )}
        <Line
          label="Gross profit"
          hint={pl.margin != null ? `${Math.round(pl.margin * 100)}% margin` : "nothing sold yet"}
          value={pl.grossProfit}
          strong
        />
        <Line label="Operating expenses" hint="ads, payroll, packing" value={-pl.expenses} />
        {/* Only when it happened. A permanent "Written off $0.00" line trains
            people to skip the row that matters when it isn't zero. */}
        {pl.disposals > 0 && (
          <Line label="Written off" hint="devices disposed, never sold" value={-pl.disposals} />
        )}
        <Line label={`Net ${positive ? "profit" : "loss"}`} value={pl.net} strong last />
      </Card>

      {byBuyer.length > 0 && (
        <Card>
          <div className="mb-1 text-[13px] font-semibold text-ink">By buyer</div>
          <p className="mb-2 text-[11.5px] text-muted">
            Realized profit on each person&apos;s buys (sold − paid − shipping share − selling
            fees, write-offs subtracted). Operating expenses aren&apos;t split — they belong to the
            business.
          </p>
          <div className="divide-y divide-line">
            {byBuyer.map(({ name, units, disposals, profit }) => (
              <div key={name} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-[13px] text-ink">
                  {name}
                  <span className="ml-1.5 text-[11.5px] text-muted">
                    {units} sold{disposals > 0 ? ` · ${disposals} written off` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex-shrink-0 text-[13px] font-semibold tabular-nums",
                    profit < 0 ? "text-red-600" : "text-cash",
                  )}
                >
                  {profit < 0 ? `(${currency(Math.abs(profit))})` : currency(profit)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pl.expensesByCategory.length > 0 && (
        <Card>
          <div className="mb-2 text-[13px] font-semibold text-ink">Expenses by category</div>
          <div className="divide-y divide-line">
            {pl.expensesByCategory.map(({ category, total }) => (
              <div key={category} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[13px] text-ink">{category}</span>
                <span className="text-[13px] font-semibold text-ink">{currency(total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-[12px] text-muted">
        Invoices that have shipped but not settled are not counted — what a buyer owes is not what
        they paid. Devices still in stock cost nothing here until they sell or are written off.
      </p>
    </div>
  );
}

function Line({ label, hint, value, strong = false, last = false }) {
  const negative = value < 0;
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-2",
        !last && "border-b border-line",
        strong && "font-semibold",
      )}
    >
      <div className="min-w-0">
        <span className={cn("text-[13.5px]", strong ? "text-ink" : "text-ink")}>{label}</span>
        {hint && <span className="ml-1.5 text-[11.5px] text-muted">{hint}</span>}
      </div>
      <span
        className={cn(
          "flex-shrink-0 text-[13.5px] tabular-nums",
          negative ? "text-red-600" : strong ? "text-cash" : "text-ink",
        )}
      >
        {negative ? `(${currency(Math.abs(value))})` : currency(value)}
      </span>
    </div>
  );
}
