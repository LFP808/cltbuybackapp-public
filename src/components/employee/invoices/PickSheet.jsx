"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ArrowLeft } from "lucide-react";
import { Button, Card, PageTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { invoiceNumber } from "@/domain/inventory";

/**
 * The pick list: every device on an invoice, oldest stock first, checked off
 * by IMEI as it's pulled. (Tote grouping left with the tote scheme,
 * 2026-08-13 — the list is identity-ordered now: match the IMEI stamped on
 * the device, not a shelf address.)
 *
 * Progress lives in localStorage, not the database. A pick is a ten-minute
 * physical task, and the realistic interruption is a phone locking or a stray
 * back-swipe — not a second person picking the same invoice. Persisting locally
 * survives exactly that, for no schema and no write path.
 */
export function PickSheet({ invoice }) {
  // Oldest first — the same order stock should leave in.
  const lots = useMemo(
    () => [...(invoice.lots || [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [invoice.lots],
  );
  const total = lots.length;

  const [picked, setPicked] = useState(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  const storageKey = `pick:${invoice.id}`;

  // Read on mount, not during render: localStorage doesn't exist on the server
  // and touching it in the initializer would fail hydration.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) setPicked(new Set(saved));
    } catch {
      // A corrupt entry is not worth a broken screen — start from empty.
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...picked]));
    } catch {
      // Private-mode Safari throws on write. Losing the checkmarks on refresh
      // is survivable; refusing to let someone pick devices is not.
    }
  }, [picked, hydrated, storageKey]);

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const done = picked.size;
  const complete = total > 0 && done === total;

  return (
    <div className="mx-auto max-w-xl pb-24">
      <Button as={Link} href={`/invoices/${invoice.id}`} variant="ghost" size="sm" className="mb-2">
        <ArrowLeft size={14} /> Back to invoice
      </Button>

      <PageTitle>Pick — {invoiceNumber(invoice.number)}</PageTitle>
      <p className="-mt-2 mb-4 text-[12.5px] text-muted">
        {invoice.buyer?.name} · {total} device{total === 1 ? "" : "s"} · oldest stock first
      </p>

      {invoice.status !== "shipped" && (
        <Card className="mb-3 bg-bg">
          <p className="text-[12.5px] text-muted">
            This invoice is {invoice.status === "complete" ? "settled" : "voided"} — the list is
            here for reference. Nothing needs pulling.
          </p>
        </Card>
      )}

      <Card className="p-0">
        <ul>
          {lots.map((lot) => {
            const isPicked = picked.has(lot.id);
            return (
              <li key={lot.id} className="border-b border-line/60 last:border-0">
                {/* The whole row is the checkbox — this is used one-handed
                    with a box in the other hand, so the target is the row,
                    not a 16px square in it. */}
                <button
                  type="button"
                  onClick={() => toggle(lot.id)}
                  aria-pressed={isPicked}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-bg"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-[1.5px]",
                      isPicked ? "border-accent bg-accent text-white" : "border-line bg-white",
                    )}
                  >
                    {isPicked && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13.5px] font-semibold",
                        isPicked ? "text-muted line-through" : "text-ink",
                      )}
                    >
                      {lot.item}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-muted">
                      {/* The IMEI, not just the model — the device in
                          your hand is stamped with one, and matching a
                          model name against a shelf is a guess. */}
                      {lot.imei
                        ? `IMEI ${lot.imei}`
                        : lot.serial
                          ? `S/N ${lot.serial}`
                          : "no IMEI recorded"}
                      {[lot.carrier, lot.grade].filter(Boolean).map((part) => ` · ${part}`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Sticky footer: the count, and the way out. Nothing here writes to the
          invoice — picking is a physical task, and the money already happened
          when the invoice was created. */}
      <div className="sticky bottom-2 mt-4">
        <Card
          className={cn(
            "flex flex-wrap items-center gap-3 shadow-pop",
            complete && "bg-status-received-bg",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink">
              {done} of {total} pulled
            </div>
            <div
              role="progressbar"
              aria-label="Devices pulled"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={total}
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg"
            >
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
              />
            </div>
          </div>
          {done > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              Reset
            </Button>
          )}
          <Button as={Link} href={`/invoices/${invoice.id}`} size="sm">
            {complete ? "All pulled — done" : "Back to invoice"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
