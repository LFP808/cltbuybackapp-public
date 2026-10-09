"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { currency } from "@/domain/format";
import { stockGroups } from "@/domain/inventory";
import { runAction } from "@/lib/run-action";
import { createInvoiceAction } from "@/app/employee/invoices/actions";

/**
 * Pick stock, price each line per unit, name the buyer, ship it.
 *
 * Stock is stored one row per physical device, but nobody wants to tick 25
 * identical checkboxes — the pick list re-groups matching devices (same item,
 * carrier, grade, price paid) into one line with a "sell how many" choice,
 * defaulting to all. Units sell oldest-first inside a line.
 *
 * Layout: the pick list takes the full width it needs; buyer + money live in
 * a right rail that stays on screen while you scroll a long stock list. On a
 * phone the table becomes cards and the money footer sticks to the bottom —
 * same fields, restacked.
 */
export function InvoiceBuilder({ lots, buyers }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  // group key -> { count: units to sell, rate: per-unit price (string) }
  const [picks, setPicks] = useState(() => new Map());
  const [buyerId, setBuyerId] = useState(buyers[0]?.id || "__new__");
  const [newBuyer, setNewBuyer] = useState({
    name: "",
    street: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    terms: "",
  });
  const [shipping, setShipping] = useState("");
  const [note, setNote] = useState("");

  const groups = useMemo(() => stockGroups(lots), [lots]);

  function toggle(group) {
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(group.key)) next.delete(group.key);
      else next.set(group.key, { count: group.lots.length, rate: "" });
      return next;
    });
  }

  function patchPick(key, patch) {
    setPicks((prev) => {
      const next = new Map(prev);
      next.set(key, { ...next.get(key), ...patch });
      return next;
    });
  }

  const { units, projected, cog } = useMemo(() => {
    let u = 0;
    let p = 0;
    let c = 0;
    for (const group of groups) {
      const pick = picks.get(group.key);
      if (!pick) continue;
      const count = Math.min(Number(pick.count) || 0, group.lots.length);
      u += count;
      p += (Number(pick.rate) || 0) * count;
      c += group.cog * count;
    }
    return { units: u, projected: p, cog: c };
  }, [groups, picks]);

  function submit() {
    setError(null);
    // Oldest devices first within each line — FIFO without anyone thinking
    // about it.
    const unitPicks = [];
    for (const group of groups) {
      const pick = picks.get(group.key);
      if (!pick) continue;
      const count = Math.min(Number(pick.count) || 0, group.lots.length);
      for (const lot of group.lots.slice(0, count)) {
        unitPicks.push({ lotId: lot.id, rate: Number(pick.rate) });
      }
    }
    startTransition(async () => {
      const {
        ok,
        error: err,
        result,
      } = await runAction(() =>
        createInvoiceAction({
          buyerId: buyerId === "__new__" ? null : buyerId,
          newBuyer: buyerId === "__new__" ? newBuyer : null,
          shipping: Number(shipping) || 0,
          note,
          picks: unitPicks,
        }),
      );
      if (!ok) {
        setError(err);
        return;
      }
      router.push(`/invoices/${result.id}`);
    });
  }

  if (!groups.length) {
    return (
      <EmptyState
        title="Nothing in stock"
        description="Check in an order first — invoices are built from in-stock devices."
      />
    );
  }

  const buyerCard = (
    <Card className="space-y-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">Buyer</span>
        <select
          value={buyerId}
          onChange={(e) => setBuyerId(e.target.value)}
          className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[14px]"
        >
          {buyers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value="__new__">New buyer…</option>
        </select>
      </label>

      {buyerId === "__new__" && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg p-3">
          <div className="col-span-2">
            <Input
              label="Name"
              value={newBuyer.name}
              onChange={(e) => setNewBuyer((b) => ({ ...b, name: e.target.value }))}
              placeholder="Queen City Wireless"
            />
          </div>
          <Input
            label="Street"
            value={newBuyer.street}
            onChange={(e) => setNewBuyer((b) => ({ ...b, street: e.target.value }))}
          />
          <Input
            label="Suite / unit"
            value={newBuyer.street2}
            onChange={(e) => setNewBuyer((b) => ({ ...b, street2: e.target.value }))}
          />
          <Input
            label="City"
            value={newBuyer.city}
            onChange={(e) => setNewBuyer((b) => ({ ...b, city: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="State"
              value={newBuyer.state}
              onChange={(e) => setNewBuyer((b) => ({ ...b, state: e.target.value }))}
            />
            <Input
              label="ZIP"
              value={newBuyer.zip}
              onChange={(e) => setNewBuyer((b) => ({ ...b, zip: e.target.value }))}
            />
          </div>
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Terms (printed on the invoice)</span>
            <textarea
              value={newBuyer.terms}
              onChange={(e) => setNewBuyer((b) => ({ ...b, terms: e.target.value }))}
              rows={3}
              placeholder={"ACH Information\nAccount # - …\nRouting # - …"}
              className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Input
          label="Shipping $"
          type="number"
          step="0.01"
          min="0"
          value={shipping}
          onChange={(e) => setShipping(e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
      </div>
    </Card>
  );

  const summary = (
    <Card className="space-y-2 shadow-pop lg:shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-muted">
          {units} unit{units === 1 ? "" : "s"} · COG {currency(cog)}
        </span>
        <span className="font-mono text-[20px] font-bold tabular-nums text-accent">
          {currency(projected)}
        </span>
      </div>
      <div className="text-[12px] text-muted">
        Expected P/L{" "}
        <b className={projected - cog < 0 ? "text-destructive" : "text-status-received"}>
          {projected - cog >= 0 ? "+" : ""}
          {currency(projected - cog)}
        </b>
        {Number(shipping) > 0 && <> · before {currency(Number(shipping))} shipping</>}
      </div>
      {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      <Button className="w-full justify-center" disabled={pending || units === 0} onClick={submit}>
        {pending ? "Creating…" : "Create invoice — mark Sent"}
      </Button>
    </Card>
  );

  return (
    <div className="w-full lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4">
      {/* ---- Pick list: a table where it fits, cards where it doesn't ---- */}
      <div className="min-w-0">
        <Card className="hidden overflow-x-auto p-0 md:block">
          <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                <th className="w-10 px-4 py-2.5" />
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5">Carrier</th>
                <th className="px-3 py-2.5">Grade</th>
                <th className="px-3 py-2.5">From</th>
                <th className="px-3 py-2.5 text-center">Stock</th>
                <th className="px-3 py-2.5 text-center">Sell</th>
                <th className="px-3 py-2.5 text-right">COG</th>
                <th className="px-3 py-2.5 text-right">$ /unit</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const pick = picks.get(group.key);
                const picked = Boolean(pick);
                const count = picked ? Math.min(Number(pick.count) || 0, group.lots.length) : 0;
                const from = [...group.orderNames].join(", ");
                return (
                  <tr
                    key={group.key}
                    className={cn(
                      "border-b border-line/60 last:border-0",
                      picked ? "bg-accent-l/40" : "hover:bg-bg",
                    )}
                  >
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggle(group)}
                        aria-label={`Pick ${lineLabel(group)}`}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                    </td>
                    <td
                      className="max-w-[260px] cursor-pointer truncate px-3 py-2 text-ink"
                      onClick={() => toggle(group)}
                      title={group.item}
                    >
                      {group.item}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{group.carrier || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{group.grade || "—"}</td>
                    <td className="max-w-[130px] truncate px-3 py-2 text-muted" title={from}>
                      {from || "—"}
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular-nums">
                      {group.lots.length}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min="1"
                        max={group.lots.length}
                        value={picked ? pick.count : ""}
                        disabled={!picked}
                        onChange={(e) => patchPick(group.key, { count: e.target.value })}
                        aria-label={`How many ${lineLabel(group)} to sell`}
                        className="w-14 rounded-md border border-line px-2 py-1 text-center font-mono text-[12.5px] disabled:bg-bg disabled:text-muted"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted">
                      {currency(group.cog)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={picked ? pick.rate : ""}
                        disabled={!picked}
                        onChange={(e) => patchPick(group.key, { rate: e.target.value })}
                        placeholder="0.00"
                        aria-label={`Invoice price per unit for ${lineLabel(group)}`}
                        className="w-20 rounded-md border border-line px-2 py-1 text-right font-mono text-[12.5px] disabled:bg-bg disabled:text-muted"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                      {picked ? currency((Number(pick.rate) || 0) * count) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Phone: one card per line, the same fields stacked. */}
        <div className="space-y-2 md:hidden">
          {groups.map((group) => {
            const pick = picks.get(group.key);
            const picked = Boolean(pick);
            const count = picked ? Math.min(Number(pick.count) || 0, group.lots.length) : 0;
            const from = [...group.orderNames].join(", ");
            return (
              <Card key={group.key} className={cn("p-3", picked && "border-accent/40 bg-accent-l/30")}>
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => toggle(group)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{group.item}</span>
                    <span className="block text-[11.5px] text-muted">
                      {[group.carrier, group.grade].filter(Boolean).join(" · ")}
                      {from ? ` · ${from}` : ""} · {group.lots.length} in stock ·{" "}
                      {currency(group.cog)} COG
                    </span>
                  </span>
                </label>
                {picked && (
                  <div className="mt-2.5 flex items-center gap-2 pl-6">
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">
                      Sell
                      <input
                        type="number"
                        min="1"
                        max={group.lots.length}
                        value={pick.count}
                        onChange={(e) => patchPick(group.key, { count: e.target.value })}
                        className="w-14 rounded-md border border-line bg-white px-2 py-1.5 text-center font-mono text-[13px]"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[12px] text-muted">
                      at $
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={pick.rate}
                        onChange={(e) => patchPick(group.key, { rate: e.target.value })}
                        placeholder="0.00"
                        className="w-20 rounded-md border border-line bg-white px-2 py-1.5 text-right font-mono text-[13px]"
                      />
                    </label>
                    <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums text-ink">
                      {currency((Number(pick.rate) || 0) * count)}
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* On mobile the buyer form flows after the picks… */}
        <div className="mt-4 space-y-3 lg:hidden">{buyerCard}</div>
      </div>

      {/* …on desktop it rides a sticky right rail with the money. */}
      <div className="hidden space-y-3 lg:sticky lg:top-20 lg:block">
        {buyerCard}
        {summary}
      </div>

      {/* Mobile money footer — the total never scrolls away mid-pick. */}
      <div className="sticky bottom-2 mt-4 lg:hidden">{summary}</div>
    </div>
  );
}

/**
 * What tells one line apart from another when the product name doesn't.
 *
 * Groups are keyed on item + carrier + grade + COG, so two rows of the same
 * product are the normal case — and every control in the row used to be
 * labelled with the item name alone. A screen reader announced "Pick iPhone
 * 15 Pro Max" twice with nothing to choose between, and anything addressing
 * "the second price field" was really addressing whichever row the query
 * happened to return second. The carrier and grade are exactly what a person
 * reads across the row to tell them apart, so they belong in the name.
 */
function lineLabel(group) {
  return `${group.item}, ${group.carrier || "any carrier"}, grade ${group.grade || "?"}`;
}
