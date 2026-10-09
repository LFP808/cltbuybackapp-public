"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ReceiptText, Trash2 } from "lucide-react";
import { Card, Button, Input, Badge, Modal, DialogFooter, EmptyState } from "@/components/ui";
import { DateRangePicker } from "@/components/employee/dashboard/DateRangePicker";
import { resolveRange, inRange } from "@/domain/date-range";
import {
  expenseCategories,
  expensesTotal,
  totalsByCategory,
  isOwnerDraw,
  OWNER_DRAW_CATEGORY,
} from "@/domain/expenses";
import { cn } from "@/lib/cn";
import { currency } from "@/domain/format";
import { dayKey, parseLocalDate } from "@/domain/dates";
import { addExpenseAction, deleteExpenseAction } from "@/app/employee/expenses/actions";

// No "day"/"week": expenses arrive in monthly rhythms (ad invoices, payroll
// runs), so the shortest preset worth offering is the month.
const EXPENSE_RANGES = ["month", "30d", "90d", "ytd", "all", "custom"];

/** YYYY-MM-DD -> "Jul 12, 2026". Returns the raw value if unparseable. */
function fmtDay(value) {
  const d = parseLocalDate(value);
  if (!d) return value || "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The expense ledger as one screen: record at the top, then what the chosen
 * period cost — in total, by category, and entry by entry.
 */
export function ExpensesManager({ expenses }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState(() => ({
    spentOn: dayKey(new Date()),
    category: "",
    newCategory: "",
    vendor: "",
    amount: "",
    note: "",
  }));
  // "expense" | "draw". A draw is not a cost, and asking people to know the
  // magic category name buried it — the toggle makes taking profit out a
  // first-class entry that still lands in the same ledger row shape.
  const [entryKind, setEntryKind] = useState("expense");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [rangeKey, setRangeKey] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

  // The entry pending deletion, or null. Removing a money record is the kind
  // of click that confirms first, like every send and stage change.
  const [removing, setRemoving] = useState(null);

  const categories = expenseCategories(expenses);
  const chosenCategory =
    entryKind === "draw"
      ? OWNER_DRAW_CATEGORY
      : form.category === "__new__"
        ? form.newCategory
        : form.category;

  const range = useMemo(
    () => resolveRange({ range: rangeKey, from: customFrom, to: customTo }),
    [rangeKey, customFrom, customTo],
  );
  const filtered = useMemo(
    () =>
      expenses.filter((e) => inRange(parseLocalDate(e.spentOn)?.getTime() ?? e.createdAt, range)),
    [expenses, range],
  );
  // Owner draws sit in this ledger but are not costs: "what did the period
  // cost" must not rise because profit was taken out. They get their own
  // figure beside the total instead of quietly inflating it.
  const costs = filtered.filter((e) => !isOwnerDraw(e));
  const total = expensesTotal(costs);
  const byCategory = totalsByCategory(costs);
  const drawsTotal = expensesTotal(filtered.filter(isOwnerDraw));

  const set = (k) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [k]: value }));
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  function submit(e) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await addExpenseAction({
        spentOn: form.spentOn,
        category: chosenCategory,
        vendor: form.vendor,
        note: form.note,
        amount: form.amount,
      });
      if (result?.error) {
        setError(result.error);
        setFieldErrors(result.fieldErrors || {});
        return;
      }
      // Date and category survive on purpose: receipts get entered in runs,
      // and a stack of same-day ad invoices shouldn't re-ask the same two
      // questions for every line.
      setForm((f) => ({ ...f, vendor: "", amount: "", note: "" }));
      router.refresh();
    });
  }

  function remove() {
    const target = removing;
    setRemoving(null);
    startTransition(async () => {
      const result = await deleteExpenseAction(target.id);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 inline-flex rounded-lg border border-line p-0.5">
          {[
            ["expense", "Expense"],
            ["draw", "Owner draw"],
          ].map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setEntryKind(kind)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
                entryKind === kind ? "bg-accent text-white" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="w-36">
            <Input
              label="Date"
              type="date"
              value={form.spentOn}
              onChange={set("spentOn")}
              error={fieldErrors.spentOn}
            />
          </div>
          {entryKind === "expense" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Category</span>
              <select
                className="h-9 rounded-lg border border-line bg-white px-3 text-[14px]"
                value={form.category}
                onChange={set("category")}
              >
                <option value="">Pick…</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="__new__">New category…</option>
              </select>
            </label>
          )}
          {entryKind === "expense" && form.category === "__new__" && (
            <div className="min-w-[150px]">
              <Input
                label="New category"
                placeholder="e.g. Insurance"
                value={form.newCategory}
                onChange={set("newCategory")}
              />
            </div>
          )}
          <div className="min-w-[140px] flex-1">
            <Input
              label="Paid to"
              placeholder="e.g. Meta, ULINE (optional)"
              value={form.vendor}
              onChange={set("vendor")}
            />
          </div>
          <div className="w-28">
            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.amount}
              onChange={set("amount")}
              error={fieldErrors.amount}
            />
          </div>
          <Button type="submit" disabled={pending || !chosenCategory.trim() || !form.amount}>
            {entryKind === "draw" ? "Record draw" : "Add expense"}
          </Button>
          <div className="w-full">
            <Input
              label="Note"
              placeholder="What was it for? (optional)"
              value={form.note}
              onChange={set("note")}
            />
          </div>
        </form>
        {(error || fieldErrors.category) && (
          <p className="mt-2 text-[13px] text-red-500">{fieldErrors.category || error}</p>
        )}
      </Card>

      {/* Same chip-and-modal as the orders list, from the same component — the
          two screens can't drift into different ideas of "this month". */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setRangeOpen(true)}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-2 text-[12.5px] font-medium text-ink shadow-xs transition-colors hover:border-accent/40"
        >
          <Calendar size={13} className="text-accent" />
          {range.label}
        </button>
        <span className="ml-auto whitespace-nowrap text-[12.5px] text-muted">
          <span className="font-semibold text-ink">{filtered.length}</span>
          {filtered.length === 1 ? " entry" : " entries"}
          {total > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-red-600">{currency(total)}</span>
            </>
          )}
          {drawsTotal > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-ink">{currency(drawsTotal)}</span> taken out
            </>
          )}
        </span>
      </div>

      <Modal open={rangeOpen} onClose={() => setRangeOpen(false)} title="Date range">
        <DateRangePicker
          value={rangeKey}
          onChange={setRangeKey}
          from={customFrom}
          to={customTo}
          onFromChange={setCustomFrom}
          onToChange={setCustomTo}
          allow={EXPENSE_RANGES}
        />
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <Button onClick={() => setRangeOpen(false)}>Done</Button>
        </div>
      </Modal>

      {byCategory.length > 1 && (
        <Card>
          <div className="mb-2 text-[13px] font-semibold text-ink">By category</div>
          <div className="divide-y divide-line">
            {byCategory.map(({ category, total: catTotal }) => (
              <div key={category} className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[13px] text-ink">{category}</span>
                <span className="text-[13px] font-semibold text-ink">{currency(catTotal)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={ReceiptText}>
            No expenses in this period.
            {range.key !== "all" && (
              <>
                {" "}
                <button
                  onClick={() => {
                    setRangeKey("all");
                    setCustomFrom("");
                    setCustomTo("");
                  }}
                  className="font-semibold text-accent underline"
                >
                  Show all time
                </button>
                ?
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {filtered.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-24 flex-shrink-0 text-[12.5px] text-muted">
                  {fmtDay(e.spentOn)}
                </span>
                <Badge className="bg-bg text-muted">{e.category}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {e.vendor}
                  {e.vendor && e.note ? " · " : ""}
                  {e.note && <span className="text-muted">{e.note}</span>}
                </span>
                <span className="text-[13px] font-semibold text-ink">{currency(e.amount)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setRemoving(e)}
                  aria-label={`Remove ${e.category} expense of ${currency(e.amount)}`}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove expense">
        {removing && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              Remove {currency(removing.amount)} — {removing.category}
              {removing.vendor ? `, ${removing.vendor}` : ""} — from {fmtDay(removing.spentOn)}?
            </p>
            <p className="text-[12px] text-muted">
              It comes straight out of every total on this page. There is no undo; re-enter it if it
              was real.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRemoving(null)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={remove} disabled={pending}>
                Remove
              </Button>
            </DialogFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}
