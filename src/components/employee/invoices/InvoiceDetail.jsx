"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, PackageSearch } from "lucide-react";
import { Button, Card, Modal, DialogFooter, PageTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { currency } from "@/domain/format";
import { dayKey } from "@/domain/dates";
import { PAYMENT_METHODS } from "@/domain/constants";
import {
  invoiceNumber,
  invoicePL,
  invoiceLines,
  unitCount,
  lotCogTotal,
  canSettleInvoice,
  canVoidInvoice,
} from "@/domain/inventory";
import { runAction } from "@/lib/run-action";
import { BuyerExport } from "@/components/employee/invoices/BuyerExport";
import {
  settleInvoiceAction,
  voidInvoiceAction,
  correctSettlementAction,
} from "@/app/employee/invoices/actions";

const STATUS_TONES = {
  shipped: "bg-status-sent-bg text-status-sent",
  complete: "bg-status-paid-bg text-status-paid",
  voided: "bg-bg text-muted ring-1 ring-inset ring-line",
};

// The stored status is "shipped" for schema continuity; the UI says what it
// means here — the document went to the buyer ("Sent") and money closed it
// ("Settled"). Matches LOT_STATUS_LABELS calling the same state "On Invoice".
const STATUS_LABELS = { shipped: "Sent", complete: "Settled", voided: "Voided" };

/**
 * One invoice: the grouped lines as the paper document shows them, the
 * projected payout, the buyer export, and the settle step — the actual price
 * each device sold for, prefilled from asking, summed live so what should
 * have cleared is visible before anything is written. Voiding is here too,
 * for sent invoices only; settled money is a conversation.
 */
export function InvoiceDetail({ invoice, canEdit = true, paymentMethods = PAYMENT_METHODS }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [method, setMethod] = useState("ACH");
  const [paidDate, setPaidDate] = useState(dayKey(new Date()));
  // Prefilled with the create-time figure — usually 0, most sales are local
  // handovers. The settle-time number is authoritative and is stored back.
  const [shipping, setShipping] = useState(() => String(invoice.shipping || 0));
  const [voiding, setVoiding] = useState(false);
  // Correcting a settled amount: closed by default, because the ordinary case
  // is reading the number, not doubting it.
  const [correcting, setCorrecting] = useState(false);
  const [correctedPaid, setCorrectedPaid] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const lots = useMemo(
    () =>
      [...(invoice.lots || [])].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)),
    [invoice.lots],
  );
  const lines = useMemo(() => invoiceLines(lots), [lots]);
  // Per-line ACTUAL sold price, per unit, prefilled with the asking rate —
  // the sheet usually comes back mostly as quoted, so typing starts from
  // agreement and only the lines that moved get touched. (Initializer reads
  // `lines` computed just above; hooks run in declaration order.)
  const [actuals, setActuals] = useState(() =>
    Object.fromEntries(lines.map((line) => [line.key, line.rate != null ? String(line.rate) : ""])),
  );

  const units = unitCount(lots);
  const cogTotal = lots.reduce((sum, lot) => sum + lotCogTotal(lot), 0);
  const pl = invoicePL(invoice);

  // Live mirror of the action's math (same cents-per-unit sums), so the
  // footer's "should have cleared" cannot disagree with what settling writes.
  const settle = useMemo(() => {
    let valid = lines.length > 0;
    let sumCents = 0;
    for (const line of lines) {
      const raw = actuals[line.key];
      const n = Number(raw);
      if (raw == null || raw === "" || !Number.isFinite(n) || n < 0) {
        valid = false;
        continue;
      }
      sumCents += Math.round(n * 100) * line.quantity;
    }
    const shipNum = Number(shipping || 0);
    const shipOk = Number.isFinite(shipNum) && shipNum >= 0;
    const shipCents = shipOk ? Math.round(shipNum * 100) : 0;
    return {
      valid,
      shipOk,
      sum: sumCents / 100,
      cleared: (sumCents - shipCents) / 100,
      deltaVsAsk: (sumCents - Math.round(invoice.projected * 100)) / 100,
    };
  }, [lines, actuals, shipping, invoice.projected]);

  const paidDelta =
    invoice.paid != null ? Math.round((invoice.paid - invoice.projected) * 100) / 100 : 0;

  function act(fn) {
    setError(null);
    startTransition(async () => {
      const { ok, error: err } = await runAction(fn);
      if (!ok) {
        setError(err);
        return;
      }
      setVoiding(false);
      setCorrecting(false);
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-2.5">
        <PageTitle>
          {invoiceNumber(invoice.number)} — {invoice.buyer?.name}
        </PageTitle>
        <span
          className={cn(
            "mb-4 inline-flex rounded-pill px-2.5 py-0.5 text-[10.5px] font-semibold",
            STATUS_TONES[invoice.status],
          )}
        >
          {STATUS_LABELS[invoice.status]}
        </span>
        <span className="mb-4 ml-auto flex flex-wrap gap-2">
          {canEdit && canVoidInvoice(invoice) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setVoiding(true)}
            >
              Void…
            </Button>
          )}
          <BuyerExport invoice={invoice} lots={lots} />
          {/* Only while sent: a settled or voided invoice has nothing left
              to pull, and the pick screen says so if you open it anyway. */}
          {invoice.status === "shipped" && (
            <Button as={Link} href={`/invoices/${invoice.id}/pick`} size="sm">
              <PackageSearch size={14} /> Pick devices
            </Button>
          )}
          <Button as={Link} href={`/invoices/${invoice.id}/print`} variant="ghost" size="sm">
            <Printer size={14} /> Print / PDF
          </Button>
        </span>
      </div>

      <p className="-mt-2 mb-4 text-[12.5px] text-muted">
        {new Date(invoice.createdAt).toLocaleDateString()} · {units} unit{units === 1 ? "" : "s"}
        {invoice.shipping > 0 ? ` · shipping ${currency(invoice.shipping)}` : ""}
        {invoice.note ? ` · ${invoice.note}` : ""}
      </p>

      <Card className="mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              <th className="px-4 py-2.5">Line</th>
              <th className="px-3 py-2.5 text-center">Qty</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-right">COG</th>
              {invoice.status === "complete" && (
                <>
                  <th className="px-3 py-2.5 text-right">Sold for</th>
                  <th className="px-3 py-2.5 text-right">P/L</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {/* Devices are stored one per row, but the document reads in
                lines — an IMEI device is its own line (buyers buy serials),
                and identity-less units re-group with a quantity, like the
                paper. */}
            {lines.map((line) => {
              const linePL = line.settled ? line.pl : null;
              // Asking vs actual, to the cent — red when the buyer knocked it
              // down, green when it cleared over ask.
              const soldDelta = line.settled
                ? Math.round((line.soldTotal - (line.invoiceTotal || 0)) * 100) / 100
                : 0;
              return (
                <tr key={line.key} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2">
                    {line.item}
                    <span className="text-muted">
                      {[line.carrier, line.grade].filter(Boolean).map((part) => ` · ${part}`)}
                      {line.imei || line.serial ? (
                        <span className="font-mono text-[11.5px]">
                          {" "}
                          · {line.imei || line.serial}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center font-mono tabular-nums">{line.quantity}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {line.rate != null ? currency(line.rate) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {line.rate != null ? currency(line.invoiceTotal) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {currency(line.cogTotal)}
                  </td>
                  {invoice.status === "complete" && (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                        {line.settled ? (
                          <>
                            {currency(line.soldTotal)}
                            {soldDelta !== 0 && (
                              <span
                                className={cn(
                                  "block text-[10.5px] font-semibold",
                                  soldDelta < 0 ? "text-destructive" : "text-cash",
                                )}
                              >
                                {soldDelta > 0 ? "+" : "−"}
                                {currency(Math.abs(soldDelta))} vs ask
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums",
                          linePL == null
                            ? "text-muted"
                            : linePL < 0
                              ? "text-destructive"
                              : "text-cash",
                        )}
                      >
                        {linePL != null ? `${linePL > 0 ? "+" : ""}${currency(linePL)}` : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="px-4 py-2.5">Projected payout</td>
              <td className="px-3 py-2.5 text-center font-mono tabular-nums">{units}</td>
              <td />
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                {currency(invoice.projected)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-muted">
                {currency(cogTotal)}
              </td>
              {invoice.status === "complete" && (
                <>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                    {currency(lots.reduce((s, l) => s + (l.soldTotal || 0), 0))}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums",
                      pl < 0 ? "text-destructive" : "text-status-received",
                    )}
                  >
                    {pl != null ? `${pl > 0 ? "+" : ""}${currency(pl)}` : "—"}
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </Card>

      {canEdit && canSettleInvoice(invoice) && (
        <Card className="bg-bg">
          <div className="text-[13px] font-semibold text-ink">Settle — actual prices</div>
          <p className="mt-1 text-[12px] text-muted">
            What each device really sold for, prefilled with its asking price. On a grouped line the
            price is per unit and applies to every device in it.
          </p>

          <ul className="mt-1 divide-y divide-line/60">
            {lines.map((line) => {
              const raw = actuals[line.key] ?? "";
              const n = Number(raw);
              const ok = raw !== "" && Number.isFinite(n) && n >= 0;
              return (
                <li key={line.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                    {line.item}
                    <span className="text-muted">
                      {[line.carrier, line.grade].filter(Boolean).map((part) => ` · ${part}`)}
                      {line.imei || line.serial ? (
                        <span className="font-mono text-[11px]"> · {line.imei || line.serial}</span>
                      ) : null}
                    </span>
                    {line.quantity > 1 && (
                      <span className="ml-1.5 rounded-pill bg-bg px-1.5 py-0.5 text-[10.5px] font-semibold text-muted">
                        ×{line.quantity} · per unit
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-muted">
                    ask {line.rate != null ? currency(line.rate) : "—"}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={raw}
                    onChange={(e) =>
                      setActuals((prev) => ({ ...prev, [line.key]: e.target.value }))
                    }
                    aria-label={`Actual sold price per unit for ${settleLineLabel(line)}`}
                    className={cn(
                      "w-24 rounded-lg border bg-white px-2.5 py-1.5 text-right font-mono text-[13px]",
                      ok ? "border-line" : "border-destructive",
                    )}
                  />
                  {line.quantity > 1 && (
                    <span className="w-24 whitespace-nowrap text-right font-mono text-[12px] tabular-nums text-muted">
                      {ok ? `= ${currency(n * line.quantity)}` : "—"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[12.5px] text-muted">Shipping $</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                className={cn(
                  "w-24 rounded-lg border bg-white px-3 py-2 font-mono text-[13px]",
                  settle.shipOk ? "border-line" : "border-destructive",
                )}
              />
            </div>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-[13px]"
            >
              {/* ACH leads even when the admin's payment_methods list omits
                  it — buyer terms print ACH details, and that is how buyers
                  overwhelmingly pay. */}
              {["ACH", ...paymentMethods.filter((m) => m !== "ACH")].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              className="rounded-lg border border-line px-3 py-2 font-mono text-[12.5px]"
            />
          </div>

          {/* The reconciliation footer: sum of actuals, minus shipping, is
              the figure the bank statement should show. */}
          <div className="mt-3 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-line">
            <div className="flex justify-between text-[12.5px]">
              <span className="text-muted">
                Actuals · {units} unit{units === 1 ? "" : "s"}
              </span>
              <span className="font-mono tabular-nums">
                {settle.valid ? currency(settle.sum) : "—"}
              </span>
            </div>
            {Number(shipping) > 0 && (
              <div className="flex justify-between text-[12.5px]">
                <span className="text-muted">− shipping (spread evenly per unit)</span>
                <span className="font-mono tabular-nums">
                  {settle.shipOk ? `−${currency(Number(shipping))}` : "—"}
                </span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-[13px] font-semibold">
              <span>Should have cleared</span>
              <span className="font-mono tabular-nums">
                {settle.valid && settle.shipOk ? currency(settle.cleared) : "—"}
              </span>
            </div>
          </div>

          {settle.valid && settle.deltaVsAsk !== 0 && (
            <p className="mt-2.5 rounded-lg bg-status-awaiting-bg px-3 py-2 text-[12px] text-status-awaiting">
              {settle.deltaVsAsk < 0 ? "Under" : "Over"} the asking total by{" "}
              <b>{currency(Math.abs(settle.deltaVsAsk))}</b>.
            </p>
          )}
          {settle.valid && settle.shipOk && (
            <p className="mt-2 text-[12px] text-muted">
              Settling locks P/L at{" "}
              <b
                className={
                  settle.cleared - cogTotal < 0 ? "text-destructive" : "text-status-received"
                }
              >
                {currency(settle.cleared - cogTotal)}
              </b>{" "}
              (actuals − shipping − COG).
            </p>
          )}
          {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}

          <div className="mt-3 flex justify-end">
            <Button
              disabled={pending || !settle.valid || !settle.shipOk}
              onClick={() =>
                act(() =>
                  settleInvoiceAction(invoice.id, {
                    lines: lines.map((line) => ({
                      key: line.key,
                      price: Number(actuals[line.key]),
                    })),
                    shipping: Number(shipping) || 0,
                    paidMethod: method,
                    paidDate,
                  }),
                )
              }
            >
              {pending ? "Settling…" : "Settle — mark Settled"}
            </Button>
          </div>
        </Card>
      )}

      {invoice.status === "complete" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted">
              Asked {currency(invoice.projected)} → paid {currency(invoice.paid)}
              {paidDelta !== 0 && (
                <b className={paidDelta < 0 ? "text-destructive" : "text-status-received"}>
                  {" "}
                  ({paidDelta > 0 ? "+" : "−"}
                  {currency(Math.abs(paidDelta))})
                </b>
              )}
              {invoice.paidMethod ? ` via ${invoice.paidMethod}` : ""} on{" "}
              {new Date(invoice.paidAt || invoice.createdAt).toLocaleDateString()} · P/L{" "}
              <b className={pl < 0 ? "text-destructive" : "text-status-received"}>
                {pl > 0 ? "+" : ""}
                {currency(pl)}
              </b>
            </p>
            {canEdit && !correcting && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCorrecting(true);
                  setCorrectedPaid(String(invoice.paid ?? ""));
                  setCorrectionReason("");
                }}
              >
                Correct amount…
              </Button>
            )}
          </div>

          {/* Voiding refuses a settled invoice and says "correct it with the
              buyer" — this is that correction. Each device keeps the price it
              settled at plus an even per-unit share of the difference, so the
              per-line actuals survive and P/L follows instead of drifting. */}
          {correcting && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <p className="text-[12px] text-muted">
                Use this when the settled total was typed wrong or the buyer&apos;s payment changed.
                The difference spreads evenly per unit across the same devices — each line keeps its
                settled price plus its share — and every P/L on the invoice, the grid, and the books
                moves with it.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-muted">Corrected amount</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={correctedPaid}
                    onChange={(e) => setCorrectedPaid(e.target.value)}
                    className="h-9 w-32 rounded-lg border border-line px-3 text-[13px] outline-none focus:border-accent"
                  />
                </label>
                <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                  <span className="text-[12px] font-medium text-muted">Why?</span>
                  <input
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="e.g. transposed digits, buyer sent a second payment"
                    className="h-9 w-full rounded-lg border border-line px-3 text-[13px] outline-none focus:border-accent"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending || !correctedPaid || !correctionReason.trim()}
                  onClick={() =>
                    act(() =>
                      correctSettlementAction(invoice.id, {
                        paid: correctedPaid,
                        paidMethod: invoice.paidMethod,
                        reason: correctionReason,
                      }),
                    )
                  }
                >
                  {pending ? "Saving…" : "Save correction"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {invoice.status === "voided" && (
        <Card>
          <p className="text-[13px] text-muted">
            Voided on {new Date(invoice.voidedAt || invoice.createdAt).toLocaleDateString()} — every
            lot went back to stock. The number stays burned so the sequence audits clean.
          </p>
        </Card>
      )}

      <Modal
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void ${invoiceNumber(invoice.number)}?`}
      >
        <p className="text-[13px] text-muted">
          Every lot on this invoice returns to In Stock and the invoice stays in the list, struck
          through. This can&apos;t be undone — the number is burned either way.
        </p>
        {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setVoiding(false)} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => act(() => voidInvoiceAction(invoice.id))}
          >
            {pending ? "Voiding…" : "Void invoice"}
          </Button>
        </DialogFooter>
      </Modal>
    </div>
  );
}

/**
 * What tells one settle input apart from another when the product name
 * doesn't — same lesson as the builder's lineLabel: two "iPhone 15 Pro Max"
 * lines need carrier/grade/identity in the accessible name or a screen
 * reader announces them identically.
 */
function settleLineLabel(line) {
  const identity = line.imei ? `, IMEI ${line.imei}` : line.serial ? `, S/N ${line.serial}` : "";
  return `${line.item}, ${line.carrier || "any carrier"}, grade ${line.grade || "?"}${identity}`;
}
