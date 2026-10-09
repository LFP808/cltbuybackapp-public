"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button, Modal, DialogFooter, Input } from "@/components/ui";
import { DEFAULT_GRADES, itemNameFromSickw, carrierFromSickw } from "@/domain/inventory";
import { runAction } from "@/lib/run-action";
import {
  updateLotFactsAction,
  deleteLotAction,
  disposeLotAction,
  sellLotDirectAction,
  undoDirectSaleAction,
  sickwLookupAction,
} from "@/app/employee/inventory/actions";

/** Local YYYY-MM-DD for the sale-date default. */
function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Fix one device's facts (a lot IS one physical device): IMEI, serial,
 * carrier, grade, and what was paid — and the two ways it leaves the shelf
 * without an invoice: an eBay sale (price − fees − label) and a write-off.
 * Every change is logged (who, when, was → is) by the actions. Invoiced
 * devices still lock; the one sold state that opens here is a DIRECT sale,
 * which shows its numbers and offers the undo an invoice gets via Void.
 *
 * FACT EDITING IS ADMIN ONLY (Jaime, 2026-10-03) — unlike dispose/sell/
 * delete below, which both roles keep. `isAdmin=false` renders the facts as
 * plain text instead of inputs and hides Save; the action enforces the same
 * rule server-side, so this is a courtesy, not the real gate. Every past
 * edit is listed (not just the latest) so "who changed what" never requires
 * asking around.
 */
export function LotEditDialog({ lot, onClose, grades = DEFAULT_GRADES, isAdmin = false }) {
  const router = useRouter();
  const [item, setItem] = useState("");
  const [imei, setImei] = useState("");
  const [serial, setSerial] = useState("");
  const [carrier, setCarrier] = useState("");
  const [grade, setGrade] = useState("");
  const [cog, setCog] = useState("");
  // Set only after a re-check comes back; carried into Save untouched (it's
  // Sickw's whole report, not something typed) and cleared whenever a
  // different lot opens or another re-check runs.
  const [pendingDetails, setPendingDetails] = useState(null);
  const [rechecking, setRechecking] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [disposeNote, setDisposeNote] = useState("");
  const [selling, setSelling] = useState(false);
  const [soldPrice, setSoldPrice] = useState("");
  const [soldFees, setSoldFees] = useState("");
  const [soldShip, setSoldShip] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seed whenever a different lot opens.
  useEffect(() => {
    if (!lot) return;
    setItem(lot.item || "");
    setImei(lot.imei || "");
    setSerial(lot.serial || "");
    setCarrier(lot.carrier || "");
    setGrade(lot.grade || "");
    setCog(String(lot.cog ?? ""));
    setPendingDetails(null);
    setRechecking(false);
    setDisposing(false);
    setDisposeNote("");
    setSelling(false);
    setSoldPrice("");
    setSoldFees("");
    setSoldShip("");
    setSoldDate(todayKey());
    setError(null);
  }, [lot]);

  if (!lot) return null;

  // A direct (eBay) sale opened from the grid: show what was recorded and
  // offer the undo. No fact editing — sold facts are money history.
  if (lot.status === "complete") {
    const net =
      (Number(lot.soldTotal) || 0) - (Number(lot.feeTotal) || 0) - (Number(lot.shipTotal) || 0);
    return (
      <Modal open onClose={onClose} title={`Sold on ${lot.soldChannel || "eBay"} — ${lot.item}`}>
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">
            Sold {lot.soldAt ? new Date(lot.soldAt).toLocaleDateString() : ""} · from{" "}
            {lot.order?.name || "an order"}
            {lot.boughtBy ? ` · bought by ${lot.boughtBy}` : ""}
          </p>
          <div className="rounded-lg bg-bg px-3 py-2 text-[13px]">
            <div className="flex justify-between py-0.5">
              <span>Sold for</span>
              <span className="font-mono tabular-nums">${(Number(lot.soldTotal) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>{lot.soldChannel || "eBay"} fees</span>
              <span className="font-mono tabular-nums">−${(Number(lot.feeTotal) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>Shipping label</span>
              <span className="font-mono tabular-nums">−${(Number(lot.shipTotal) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-line py-0.5 font-semibold">
              <span>Net payout</span>
              <span className="font-mono tabular-nums">${net.toFixed(2)}</span>
            </div>
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-destructive"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Undo this sale? The device returns to stock.")) return;
                setBusy(true);
                setError(null);
                const { ok, error: err } = await runAction(() => undoDirectSaleAction(lot.id));
                setBusy(false);
                if (!ok) {
                  setError(err);
                  return;
                }
                onClose();
                router.refresh();
              }}
            >
              Undo sale…
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    );
  }

  const factsDirty =
    (lot.item || "") !== item ||
    (lot.imei || "") !== imei ||
    (lot.serial || "") !== serial ||
    (lot.carrier || "") !== carrier ||
    (lot.grade || "") !== grade ||
    Number(lot.cog ?? 0) !== Number(cog) ||
    pendingDetails != null;

  /**
   * Re-run the Sickw lookup against whatever IMEI/serial is currently in the
   * inputs (not necessarily the lot's stored one — a typo fixed first should
   * be what gets re-checked) and refresh item/carrier/serial from the real
   * answer. Same mapping check-in uses (itemNameFromSickw/carrierFromSickw),
   * so a re-check can never name the device differently than a fresh
   * check-in would have.
   *
   * Only POPULATES the form — nothing is saved until Save is clicked, same
   * as every other fact here, so a bad lookup is reviewable before it
   * overwrites a record.
   */
  async function recheck() {
    const query = (imei || serial || "").trim();
    if (!query || rechecking) return;
    setRechecking(true);
    setError(null);
    const { ok, error: err, result } = await runAction(() => sickwLookupAction(query));
    setRechecking(false);
    if (!ok) {
      setError(err);
      return;
    }
    const { fields, raw } = result;
    setItem(itemNameFromSickw(fields) || item);
    setCarrier(carrierFromSickw(fields) || carrier);
    setSerial(serial || fields.serial || "");
    setPendingDetails({ ...fields, raw });
  }

  async function act(fn) {
    setBusy(true);
    setError(null);
    const { ok, error: err } = await runAction(fn);
    setBusy(false);
    if (!ok) {
      setError(err);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal open onClose={onClose} title={`Edit device — ${lot.item}`}>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">
          In stock · from {lot.order?.name || "an order"}
          {/* Not editable here on purpose: bought-by is captured from the
              login at the buy and feeds the per-person P/L — a fact that can
              be retyped is a fact that fragments. */}
          {lot.boughtBy ? ` · bought by ${lot.boughtBy}` : ""} · checked in{" "}
          {new Date(lot.createdAt).toLocaleDateString()}
        </p>

        {!isAdmin && (
          <p className="rounded-lg bg-bg px-2.5 py-1.5 text-[11.5px] text-muted">
            Only an admin can change these facts.
          </p>
        )}

        <Input label="Item" value={item} onChange={(e) => setItem(e.target.value)} disabled={!isAdmin} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="IMEI"
            value={imei}
            onChange={(e) => setImei(e.target.value)}
            disabled={!isAdmin}
          />
          <Input
            label="Serial"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            disabled={!isAdmin}
          />
        </div>

        {/* Re-run the real Sickw lookup against whatever's in IMEI/Serial
            above and refresh Item/Carrier/Serial from it — for a device
            whose facts came from an earlier test-mode/bad lookup and were
            never corrected. Admin only, same as everything else here; the
            lookup itself only reads Sickw, nothing saves until Save does. */}
        {isAdmin && (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rechecking || !(imei.trim() || serial.trim())}
              onClick={recheck}
            >
              <RefreshCw size={13} className={rechecking ? "animate-spin" : ""} />
              {rechecking ? "Checking…" : "Re-check IMEI with Sickw"}
            </Button>
            {pendingDetails && (
              <p className="mt-1 text-[11.5px] text-status-awaiting">
                Refreshed from Sickw below — review and Save to apply.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink">Carrier</span>
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Unlocked"
              disabled={!isAdmin}
              className="w-32 rounded-lg border border-line px-3 py-2 text-[13px] disabled:bg-bg disabled:text-muted"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink">Grade</span>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              disabled={!isAdmin}
              className="rounded-lg border border-line bg-white px-3 py-2 text-[13px] disabled:bg-bg disabled:text-muted"
            >
              {/* The stored grade stays pickable even if the list changed
                  since check-in — otherwise opening the dialog silently
                  rewrites a fact nobody touched. */}
              {(grades.includes(grade) || !grade ? grades : [grade, ...grades]).map((g) => (
                <option key={g || "blank"} value={g}>
                  {g || "Pick…"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink">Paid $</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cog}
              onChange={(e) => setCog(e.target.value)}
              disabled={!isAdmin}
              className="w-24 rounded-lg border border-line px-3 py-2 text-[13px] disabled:bg-bg disabled:text-muted"
            />
          </label>
        </div>

        {/* Every past edit, newest first — not just the latest. Who changed
            what, and when, is exactly what gets asked about a corrected
            fact later. */}
        {lot.edits?.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-bg px-2.5 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Edit history
            </p>
            {[...lot.edits].reverse().map((edit, i) => (
              <p key={i} className="text-[11.5px] text-muted">
                {editLine(edit)}
              </p>
            ))}
          </div>
        )}

        {selling && (
          <div className="rounded-lg bg-cash-l/40 p-2.5">
            <label className="text-[12px] font-semibold text-cash">
              Sold on eBay — record the sale, fees and label
            </label>
            <div className="mt-1.5 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Sold $</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={soldPrice}
                  onChange={(e) => setSoldPrice(e.target.value)}
                  className="w-24 rounded-lg border border-line bg-white px-2.5 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Fees $</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={soldFees}
                  onChange={(e) => setSoldFees(e.target.value)}
                  placeholder="0.00"
                  className="w-24 rounded-lg border border-line bg-white px-2.5 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Label $</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={soldShip}
                  onChange={(e) => setSoldShip(e.target.value)}
                  placeholder="0.00"
                  className="w-24 rounded-lg border border-line bg-white px-2.5 py-2 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-muted">Sold on</span>
                <input
                  type="date"
                  value={soldDate}
                  onChange={(e) => setSoldDate(e.target.value)}
                  className="rounded-lg border border-line bg-white px-2.5 py-2 text-[13px]"
                />
              </label>
            </div>
            {/* The consequence, live — same manners as the settle preview. */}
            {Number(soldPrice) > 0 && (
              <p className="mt-1.5 text-[11.5px] text-muted">
                Net {""}
                <b className="text-ink">
                  $
                  {(
                    (Number(soldPrice) || 0) -
                    (Number(soldFees) || 0) -
                    (Number(soldShip) || 0)
                  ).toFixed(2)}
                </b>{" "}
                · P/L after the ${Number(lot.cog ?? 0).toFixed(2)} paid:{" "}
                <b className="text-ink">
                  $
                  {(
                    (Number(soldPrice) || 0) -
                    (Number(soldFees) || 0) -
                    (Number(soldShip) || 0) -
                    (Number(lot.cog) || 0)
                  ).toFixed(2)}
                </b>
              </p>
            )}
            <Button
              size="sm"
              className="mt-2"
              disabled={busy || !(Number(soldPrice) > 0)}
              onClick={() =>
                act(() =>
                  sellLotDirectAction(lot.id, {
                    soldTotal: soldPrice,
                    feeTotal: soldFees,
                    shipTotal: soldShip,
                    soldAt: soldDate,
                  }),
                )
              }
            >
              Record eBay sale
            </Button>
          </div>
        )}

        {disposing && (
          <div className="rounded-lg bg-status-awaiting-bg/40 p-2.5">
            <label className="text-[12px] font-semibold text-status-awaiting">
              Dispose this device — its cost is written off
            </label>
            <input
              value={disposeNote}
              onChange={(e) => setDisposeNote(e.target.value)}
              placeholder="Why? e.g. iCloud locked, blacklisted, dead board"
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent"
            />
            <Button
              variant="destructive"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() => act(() => disposeLotAction(lot.id, disposeNote))}
            >
              Dispose device
            </Button>
          </div>
        )}

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <DialogFooter>
          <div className="mr-auto flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Delete this device entirely? Use Dispose for dead stock.")) {
                  act(() => deleteLotAction(lot.id));
                }
              }}
            >
              Delete…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDisposing((d) => !d);
                setSelling(false);
              }}
            >
              {disposing ? "Keep it" : "Dispose…"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-cash"
              disabled={busy}
              onClick={() => {
                setSelling((s) => !s);
                setDisposing(false);
              }}
            >
              {selling ? "Not sold" : "Sold on eBay…"}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              disabled={busy || !factsDirty}
              onClick={() =>
                act(() =>
                  updateLotFactsAction(lot.id, {
                    item,
                    imei,
                    serial,
                    carrier,
                    grade,
                    cog: Number(cog),
                    ...(pendingDetails ? { details: pendingDetails } : {}),
                  }),
                )
              }
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </div>
    </Modal>
  );
}

function editLine(edit) {
  const value = (v) => (v == null || v === "" ? "—" : String(v));
  return `${edit.field} ${value(edit.from)} → ${value(edit.to)} · ${edit.by} · ${new Date(edit.at).toLocaleDateString()}`;
}
