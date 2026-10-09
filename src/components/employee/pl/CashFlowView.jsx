"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Wallet, Landmark, Banknote, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, Button, Input, Modal, DialogFooter } from "@/components/ui";
import { DateRangePicker } from "@/components/employee/dashboard/DateRangePicker";
import { resolveRange } from "@/domain/date-range";
import { computeCashFlow, fundingSummary } from "@/domain/cash";
import { OWNER_DRAW_CATEGORY } from "@/domain/expenses";
import { currency } from "@/domain/format";
import { dayKey } from "@/domain/dates";
import { addExpenseAction } from "@/app/employee/expenses/actions";
import { cn } from "@/lib/cn";

// Same presets as the P/L beside it: money arrives in monthly rhythms, so a
// day view would mostly read as a broken page.
const CASH_RANGES = ["month", "30d", "90d", "ytd", "all", "custom"];

/**
 * Cash flow — money that actually moved, and what the business holds.
 *
 * The P/L tab beside this one answers whether the trade works. This answers
 * where the money is, which is a different question. See domain/cash.js.
 *
 * THE COUNTED-BALANCE CARD IS PARKED, not gone (2026-08-08). While every cost
 * is fronted from Jaime's own pocket there is no business account whose total
 * the expected balance could match, so counting one would only measure his
 * personal life. The BusinessMoneyCard below is the balance story for this
 * phase; expectedBalance/reconcile and migration 0022 stay intact in
 * domain/cash.js for the day the business account opens (the old card lives in
 * git history on this file).
 */
export function CashFlowView({ orders, invoices, lots, expenses }) {
  const [rangeKey, setRangeKey] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

  const range = useMemo(
    () => resolveRange({ range: rangeKey, from: customFrom, to: customTo }),
    [rangeKey, customFrom, customTo],
  );
  const flow = useMemo(
    () => computeCashFlow({ orders, invoices, expenses, lots, range }),
    [orders, invoices, expenses, lots, range],
  );
  // All-time on purpose, unlike everything below the card: "what does the
  // business hold" has one answer, not one per date window.
  const funding = useMemo(
    () => fundingSummary({ orders, invoices, expenses, lots }),
    [orders, invoices, expenses, lots],
  );

  const positive = flow.net >= 0;

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
      </div>

      <Modal open={rangeOpen} onClose={() => setRangeOpen(false)} title="Date range">
        <DateRangePicker
          value={rangeKey}
          onChange={setRangeKey}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
          allow={CASH_RANGES}
        />
        <p className="mt-3 text-[12px] text-muted">
          Every figure is dated by the day the money moved - not the day the order was taken.
        </p>
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <Button onClick={() => setRangeOpen(false)}>Done</Button>
        </div>
      </Modal>

      <BusinessMoneyCard funding={funding} />

      <Card className={cn("border-2", positive ? "border-cash/40 bg-cash-l/40" : "border-red-200")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              Net movement {range.label.toLowerCase()}
            </div>
            <div
              data-cash="net"
              className={cn(
                "font-serif text-3xl",
                positive ? "text-cash" : "text-red-600",
              )}
            >
              {positive ? "+" : "-"}
              {currency(Math.abs(flow.net))}
            </div>
          </div>
          {positive ? (
            <ArrowUpRight size={28} className="text-cash" />
          ) : (
            <ArrowDownRight size={28} className="text-red-500" />
          )}
        </div>
      </Card>

      <Card>
        <SectionRow label="Money in" total={flow.totalIn} tone="in" cash="total-in" />
        {/* The eBay row hides while zero — most months either sell on eBay or
            don't, and a standing $0.00 line trains eyes to skip the section. */}
        {flow.inflow
          .filter((b) => b.key !== "direct_sales" || b.amount !== 0)
          .map((b) => (
            <Line key={b.key} label={b.label} hint={b.hint} value={b.amount} cash={b.key} />
          ))}
        <div className="h-3" />
        <SectionRow label="Money out" total={flow.totalOut} tone="out" cash="total-out" />
        {flow.outflow.map((b) => (
          <Line key={b.key} label={b.label} hint={b.hint} value={-b.amount} cash={b.key} />
        ))}
        <Line
          label={positive ? "Net into the business" : "Net out of the business"}
          value={flow.net}
          strong
          last
        />
      </Card>

      {flow.byMethod.length > 0 && (
        <Card>
          <div className="mb-1 text-[13px] font-semibold text-ink">How payouts were made</div>
          {/* Does not change a single total - both pools are the same money.
              It answers a different question: how much has to be in the drawer
              before the day's meetups start. */}
          <p className="mb-2 text-[12px] text-muted">
            <span data-cash="drawer">{currency(flow.cashOut)}</span> of it came out of the drawer as
            cash.
          </p>
          <div className="divide-y divide-line">
            {flow.byMethod.map((m) => (
              <div key={m.method} className="flex items-center justify-between gap-3 py-1.5">
                <span className="flex items-center gap-1.5 text-[13px] text-ink">
                  {m.cash ? (
                    <Banknote size={13} className="text-muted" />
                  ) : (
                    <Landmark size={13} className="text-muted" />
                  )}
                  {m.method}
                  <span className="text-[11.5px] text-muted">
                    {m.count} payout{m.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-[13px] font-semibold text-ink">{currency(m.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-[12px] text-muted">What a buyer owes but has not paid is not money in.</p>
    </div>
  );
}

/**
 * The business's actual money while everything is personally funded: what
 * buyers have paid, minus what has been taken out — and beneath it, what the
 * costs have come to out of Jaime's own pocket. See fundingSummary.
 *
 * "Take money out" writes an ordinary expense in OWNER_DRAW_CATEGORY, so the
 * record lands in the same ledger as everything else and needed no migration.
 */
function BusinessMoneyCard({ funding }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState(() => ({ spentOn: dayKey(new Date()), amount: "", note: "" }));

  const set = (k) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [k]: value }));
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  function openDraw() {
    // Reset to a blank draw dated today every time, the same rule as the old
    // count dialog: a stale date from the last entry mis-files the next one.
    setForm({ spentOn: dayKey(new Date()), amount: "", note: "" });
    setError("");
    setFieldErrors({});
    setOpen(true);
  }

  // More than the pot holds is allowed — the money is all his, and refusing
  // the entry would only stop the record, not the withdrawal — but it should
  // never happen silently.
  const overdrawn = Number(form.amount) > funding.balance;

  function submit(e) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await addExpenseAction({
        spentOn: form.spentOn,
        category: OWNER_DRAW_CATEGORY,
        vendor: "",
        note: form.note,
        amount: form.amount,
      });
      if (result?.error) {
        setError(result.error);
        setFieldErrors(result.fieldErrors || {});
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Card data-panel="business-money">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              <Wallet size={12} /> Business money
            </div>
            <div
              data-cash="pot"
              className={cn(
                "font-serif text-2xl",
                funding.balance < 0 ? "text-red-600" : "text-ink",
              )}
            >
              {currency(funding.balance)}
            </div>
            <p className="mt-0.5 text-[12px] text-muted">
              <span data-cash="pot-sales">{currency(funding.sales)}</span> from buyer sales
              {funding.draws > 0 && (
                <>
                  {" "}
                  - <span data-cash="pot-draws">{currency(funding.draws)}</span> taken out
                </>
              )}
            </p>
            {funding.covered > 0 && (
              <p className="mt-1.5 text-[12px] text-muted">
                Costs so far - payouts, shipping, expenses - have been fronted personally:{" "}
                <span data-cash="covered" className="font-semibold text-ink">
                  {currency(funding.covered)}
                </span>
                .
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={openDraw}>
            Take money out
          </Button>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Take money out">
        <form onSubmit={submit} className="space-y-3">
          <p className="text-[12.5px] text-muted">
            Records a withdrawal of profit. It comes off the business-money figure and never counts
            as an operating cost, so P/L is untouched.
          </p>

          <Field label="Day" error={fieldErrors.spentOn}>
            <Input
              type="date"
              value={form.spentOn}
              onChange={set("spentOn")}
              max={dayKey(new Date())}
            />
          </Field>

          <Field label="Amount" error={fieldErrors.amount}>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={set("amount")}
            />
          </Field>

          {overdrawn && (
            <p className="text-[12px] text-amber-700">
              That is more than the {currency(funding.balance)} the business holds - the balance
              will go negative. Fine if you mean it; the figure will say so out loud.
            </p>
          )}

          <Field label="Note (optional)" error={null}>
            <Input
              placeholder="What this withdrawal was"
              value={form.note}
              onChange={set("note")}
            />
          </Field>

          {error && <p className="text-[12.5px] text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Record withdrawal"}
            </Button>
          </DialogFooter>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-ink">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[11.5px] text-red-600">{error}</span>}
    </label>
  );
}

function SectionRow({ label, total, tone, cash }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      <span
        data-cash={cash}
        className={cn(
          "tabular-nums text-[13.5px] font-semibold",
          tone === "in" ? "text-cash" : "text-ink",
        )}
      >
        {currency(total)}
      </span>
    </div>
  );
}

// `data-cash` is what scripts/cash-demo.mjs reads each figure by. Money screens
// are asserted against arithmetic done outside them, and matching on rendered
// text alone means a test that passes because some OTHER row happens to show
// the same dollar amount.
function Line({ label, hint, value, strong = false, last = false, cash }) {
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
        <span className="text-[13.5px] text-ink">{label}</span>
        {hint && <span className="ml-1.5 text-[11.5px] text-muted">{hint}</span>}
      </div>
      <span
        data-cash={cash}
        className={cn(
          "flex-shrink-0 tabular-nums text-[13.5px]",
          negative ? "text-red-600" : strong ? "text-cash" : "text-ink",
        )}
      >
        {negative ? `(${currency(Math.abs(value))})` : currency(value)}
      </span>
    </div>
  );
}
