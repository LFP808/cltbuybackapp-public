"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, StickyNote } from "lucide-react";
import { Button, Card, PageTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { uid, currency, itemsTotal } from "@/domain/format";
import { ITEM_CATALOG, categoriesOf } from "@/domain/catalog";
import { DEFAULT_GRADES, CARRIERS, itemNameFromSickw, carrierFromSickw } from "@/domain/inventory";
import { runAction } from "@/lib/run-action";
import { confirmCheckInAction, sickwLookupAction } from "@/app/employee/inventory/actions";

/**
 * The check-in screen: the order's expected lines, pre-seeded, and the
 * employee confirms what actually arrived — IMEI (or serial), carrier, grade,
 * and the price paid per device. One expected line can SPLIT into several
 * rows, because three iPhones rarely share one grade, and the same item at a
 * different grade is different money.
 *
 * The line cards ARE the diff, so there is no separate review screen: the
 * footer shows the running total against what was agreed (and, for an order
 * already paid on the spot, against what was paid), states the consequence in
 * a sentence, and confirms in one tap.
 */
export function CheckInForm({ order, catalog, grades = DEFAULT_GRADES, sickwTestMode = false }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  // Which row is mid-Sickw-lookup. One at a time on purpose: each hit spends
  // real money from the prepaid balance in live mode, and serializing them
  // keeps an impatient double-tap from double-spending.
  const [lookingUp, setLookingUp] = useState(null);

  const catalogItems = catalog?.length ? catalog : ITEM_CATALOG;
  const categories = categoriesOf(catalogItems);
  const categoryByName = useMemo(
    () => new Map(catalogItems.map((i) => [i.name, i.category])),
    [catalogItems],
  );

  // Notes the office put on the agreed lines — "cracked screen", "Find My
  // still on". Keyed by item name, the same key `expected` uses, so a note
  // follows its product through the grouping below. THIS is where a note
  // earns its keep: written on a call days ago, read by whoever now has the
  // device in hand.
  const itemNotes = useMemo(() => {
    const map = new Map();
    for (const it of order.items || []) {
      if (it.note) map.set(it.name, { note: it.note, by: it.noteBy });
    }
    return map;
  }, [order.items]);

  // What the customer SAID each item's condition was, at booking. Keyed by
  // item name like the notes; shown on the card and used to seed the grade,
  // so the bench starts from the claim and changes it when the device
  // disagrees — the gap between the two is the haircut.
  const itemConditions = useMemo(() => {
    const map = new Map();
    for (const it of order.items || []) {
      if (it.condition && !map.has(it.name)) map.set(it.name, it.condition);
    }
    return map;
  }, [order.items]);

  // What the order promised, by item name — the reconciliation baseline.
  const expected = useMemo(() => {
    const map = new Map();
    for (const it of order.items || []) {
      map.set(it.name, (map.get(it.name) || 0) + (Number(it.quantity) || 0));
    }
    return map;
  }, [order.items]);

  const [rows, setRows] = useState(() =>
    (order.items || []).map((it) => ({
      id: uid(),
      // What the order PROMISED this row is — the reconciliation key. A Sickw
      // lookup upgrades `item` to the device's real name ("iPhone 15 Pro Max
      // 256GB Blue"), and without a stable key that rename would tear the row
      // out of its card and mark the promised line short.
      seed: it.name,
      item: it.name,
      quantity: String(it.quantity ?? 1),
      // Seeded from the agreed line, never anchored — a dinged device takes
      // its haircut right here on its own row.
      price: String(it.price ?? ""),
      imei: "",
      serial: "",
      // Seeded from the booking's stated carrier when there is one, same as
      // grade below — a Sickw lookup or a manual pick still overrules it.
      carrier: it.carrier || "",
      // Seeded from the booking's stated condition when there is one. Kept
      // even if the ladder no longer lists it — the select below offers it
      // anyway, so a word the admin since removed is still a choice the
      // counter can keep or overrule, never a blank.
      grade: it.condition || grades[0] || "",
      // Sickw's answer, once looked up: `facts` feeds the strip under the
      // row, `details` is persisted whole onto the lot.
      facts: null,
      details: null,
      lookupError: null,
    })),
  );

  const updateRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  function splitRow(row) {
    setRows((prev) => {
      const at = prev.findIndex((r) => r.id === row.id);
      // The IMEI, serial, and everything Sickw said do NOT copy — they name
      // exactly one device each — and the item resets to the promised name,
      // because the next device may be a different storage or color.
      const clone = {
        ...row,
        id: uid(),
        quantity: "1",
        item: row.seed,
        imei: "",
        serial: "",
        facts: null,
        details: null,
        lookupError: null,
      };
      return [...prev.slice(0, at + 1), clone, ...prev.slice(at + 1)];
    });
  }

  function addItem(name) {
    if (!name) return;
    setRows((prev) => [
      ...prev,
      {
        id: uid(),
        seed: name,
        item: name,
        quantity: "1",
        price: "",
        imei: "",
        serial: "",
        carrier: "",
        grade: grades[0] || "",
        facts: null,
        details: null,
        lookupError: null,
      },
    ]);
  }

  /**
   * Ask Sickw who this device is. On success the row's item name, carrier and
   * empty serial fill from the report, the buying facts (FMI, blacklist,
   * battery) appear under the row, and the whole report is stashed to persist
   * as the lot's details. On failure the error lands beside the button and
   * every field stays hand-editable — a dead lookup is an inconvenience,
   * never a blocked buy.
   */
  async function lookUp(row) {
    // Serial fallback on purpose: Macs have no IMEI, and Sickw accepts either
    // in the same parameter (test mode has a serial fixture for exactly this).
    const query = (row.imei || row.serial || "").trim();
    if (!query || lookingUp) return;
    setLookingUp(row.id);
    updateRow(row.id, { lookupError: null });
    const { ok, error: err, result } = await runAction(() => sickwLookupAction(query));
    setLookingUp(null);
    if (!ok) {
      updateRow(row.id, { lookupError: err });
      return;
    }
    const { fields, raw } = result;
    updateRow(row.id, {
      item: itemNameFromSickw(fields) || row.item,
      carrier: carrierFromSickw(fields) || row.carrier,
      // The report includes the serial when looked up by IMEI — free fact,
      // but never overwrite one somebody already typed.
      serial: row.serial || fields.serial || "",
      facts: fields,
      // Parsed facts at the top level plus Sickw's verbatim body under `raw`
      // — the shape details jsonb keeps (see the column comment in the schema).
      details: { ...fields, raw },
      lookupError: null,
    });
  }

  // Group rows into one card per PROMISED item (row.seed), expected items
  // first in order order — grouped by the promise, not the possibly
  // Sickw-renamed item, so a looked-up row stays under the line it
  // reconciles against.
  const groups = useMemo(() => {
    const names = [];
    const byName = new Map();
    for (const row of rows) {
      if (!byName.has(row.seed)) {
        byName.set(row.seed, []);
        names.push(row.seed);
      }
      byName.get(row.seed).push(row);
    }
    return names.map((name) => {
      const groupRows = byName.get(name);
      const checked = groupRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
      const money = groupRows.reduce(
        (sum, r) => sum + (Number(r.price) || 0) * (Number(r.quantity) || 0),
        0,
      );
      return { name, rows: groupRows, checked, money, expectedQty: expected.get(name) ?? null };
    });
  }, [rows, expected]);

  const total = groups.reduce((sum, g) => sum + g.money, 0);
  const agreed = itemsTotal(order.items);
  const isPaid = order.status === "paid";
  const paidGap = isPaid && order.paidAmount != null ? total - order.paidAmount : null;

  const matches = groups.filter((g) => g.expectedQty != null && g.checked === g.expectedQty).length;
  const shorts = groups.filter((g) => g.expectedQty != null && g.checked < g.expectedQty).length;
  const extras = groups.filter((g) => g.expectedQty == null).length;
  // Expected items where nothing arrived at all still count as short.
  const missing = [...expected.keys()].filter(
    (name) => !groups.some((g) => g.name === name),
  ).length;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const { ok, error: err } = await runAction(() =>
        confirmCheckInAction(
          order.id,
          rows.map((r) => ({
            item: r.item,
            // A Sickw-renamed item isn't in the catalog; the promised name
            // still is, and it knows the category.
            category: categoryByName.get(r.item) || categoryByName.get(r.seed) || null,
            quantity: Number(r.quantity),
            price: Number(r.price) || 0,
            imei: r.imei,
            serial: r.serial,
            carrier: r.carrier,
            grade: r.grade,
            details: r.details || {},
            // Judged on the promise, not the enriched name — the rename must
            // not turn an expected device into a surprise.
            notOnOrder: !expected.has(r.seed),
          })),
        ),
      );
      if (!ok) {
        setError(err);
        return;
      }
      // The order page takes it from here: the paid-vs-counted gap and the
      // payout prefill.
      router.push(`/orders/${order.id}`);
    });
  }

  return (
    <div className="max-w-3xl pb-28">
      <div className="flex flex-wrap items-center gap-2">
        <PageTitle>Check in — {order.name}</PageTitle>
        <StatusBadge order={order} className="mb-4" />
      </div>

      {/* Known server-side only (env), said out loud here: canned answers look
          exactly like live ones, and "why does every phone come back clean?"
          should have a visible answer. */}
      {sickwTestMode && (
        <p className="-mt-2 mb-3 text-[12px] text-muted">
          Sickw test mode — lookups answer with canned data.
        </p>
      )}

      <div className="space-y-3">
        {groups.map((group) => (
          <Card key={group.name} className="space-y-2">
            {/* What the office already knows about this line, carried through
                from the order. Above the counting controls, not beside them:
                "the screen is cracked" changes what grade you pick and what
                the row is worth, so it has to be read BEFORE the counting,
                not noticed afterwards. */}
            {itemNotes.has(group.name) && (
              <p className="flex items-start gap-1.5 rounded-lg bg-status-awaiting-bg px-2.5 py-1.5 text-[12px] text-status-awaiting">
                <StickyNote size={13} className="mt-px flex-shrink-0" />
                <span>
                  {itemNotes.get(group.name).note}
                  {itemNotes.get(group.name).by && (
                    <span className="text-muted"> — {itemNotes.get(group.name).by}</span>
                  )}
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
                {group.name}
              </span>
              <span className="text-[12px] text-muted">
                {group.expectedQty == null ? (
                  <span className="rounded-pill bg-bg px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ring-line">
                    Not on order
                  </span>
                ) : (
                  <>
                    expected {group.expectedQty}
                    {itemConditions.has(group.name) && (
                      <>
                        {" "}
                        · said <b className="text-ink">{itemConditions.get(group.name)}</b>
                      </>
                    )}{" "}
                    · checked{" "}
                    <b
                      className={cn(
                        group.checked === group.expectedQty
                          ? "text-status-received"
                          : "text-status-awaiting",
                      )}
                    >
                      {group.checked}
                      {group.checked === group.expectedQty
                        ? " ✓"
                        : group.checked < group.expectedQty
                          ? ` — short ${group.expectedQty - group.checked}`
                          : ` — over by ${group.checked - group.expectedQty}`}
                    </b>
                  </>
                )}{" "}
                · <span className="font-mono">{currency(group.money)}</span>
              </span>
            </div>

            {group.rows.map((row) => (
              <div key={row.id} className="space-y-2 rounded-lg bg-bg px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                    aria-label="Quantity"
                    className="w-14 rounded-md border border-line px-2 py-1.5 text-[13px]"
                  />
                  {/* The device's identity. IMEI for phones; serial carries a
                      MacBook or anything else without one. A row with an IMEI
                      is one device — the action refuses quantity > 1 on it. */}
                  <input
                    value={row.imei}
                    onChange={(e) => updateRow(row.id, { imei: e.target.value })}
                    placeholder="IMEI"
                    aria-label="IMEI"
                    inputMode="numeric"
                    className="w-40 rounded-md border border-line px-2 py-1.5 font-mono text-[12.5px]"
                  />
                  {/* Beside the identity inputs because that is the moment it
                      is used: type or scan the IMEI (or a Mac's serial), tap,
                      and Sickw fills the name, carrier and buying facts. */}
                  <button
                    type="button"
                    onClick={() => lookUp(row)}
                    disabled={
                      pending || lookingUp !== null || !(row.imei.trim() || row.serial.trim())
                    }
                    className="rounded-md border border-line bg-white px-2 py-1.5 text-[12px] font-semibold text-accent disabled:opacity-40"
                  >
                    {lookingUp === row.id ? "Looking…" : "Look up"}
                  </button>
                  {row.lookupError && (
                    <span className="text-[11.5px] text-destructive">{row.lookupError}</span>
                  )}
                  <input
                    value={row.serial}
                    onChange={(e) => updateRow(row.id, { serial: e.target.value })}
                    placeholder="Serial"
                    aria-label="Serial"
                    className="w-28 rounded-md border border-line px-2 py-1.5 font-mono text-[12.5px]"
                  />
                  <select
                    value={row.carrier}
                    onChange={(e) => updateRow(row.id, { carrier: e.target.value })}
                    aria-label="Carrier"
                    className="rounded-md border border-line bg-white px-2 py-1.5 text-[12.5px]"
                  >
                    <option value="">Carrier…</option>
                    {CARRIERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.grade}
                    onChange={(e) => updateRow(row.id, { grade: e.target.value })}
                    aria-label="Grade"
                    className="rounded-md border border-line bg-white px-2 py-1.5 text-[12.5px]"
                  >
                    {(row.grade && !grades.includes(row.grade)
                      ? [...grades, row.grade]
                      : grades
                    ).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-muted">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.price}
                      onChange={(e) => updateRow(row.id, { price: e.target.value })}
                      placeholder="0.00"
                      aria-label="Price per unit"
                      className="w-20 rounded-md border border-line px-2 py-1.5 text-[13px]"
                    />
                    <span className="text-[11px] text-muted">/ea</span>
                  </div>
                  <span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
                    = {currency((Number(row.price) || 0) * (Number(row.quantity) || 0))}
                  </span>
                  <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row">
                    <Trash2 size={15} className="text-muted hover:text-red-500" />
                  </button>
                </div>

                {row.facts && (
                  <SickwFacts facts={row.facts} name={row.item !== group.name ? row.item : null} />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => splitRow(group.rows[group.rows.length - 1])}
              className="text-[12px] font-semibold text-accent"
            >
              + Split — another device, its own IMEI, grade, or price
            </button>
          </Card>
        ))}

        <select
          className="w-full rounded-xl border border-dashed border-line bg-transparent px-3 py-2.5 text-[13px] font-semibold text-accent"
          value=""
          onChange={(e) => addItem(e.target.value)}
        >
          <option value="">+ Add item not on the order (from catalog)…</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {catalogItems
                .filter((i) => i.category === cat)
                .map((i) => (
                  <option key={i.name} value={i.name}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* The confirm footer — summary chips, the total, and the consequence in
          one sentence. Sticky so the money never scrolls away mid-count. */}
      <div className="sticky bottom-2 mt-4 space-y-2">
        <Card className="flex flex-wrap items-center gap-3 shadow-pop">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink">Check-in total</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {matches > 0 && <Chip tone="good">{matches} match</Chip>}
              {shorts + missing > 0 && <Chip tone="warn">{shorts + missing} short</Chip>}
              {extras > 0 && <Chip>{extras} extra</Chip>}
              {agreed > 0 && (
                <Chip tone={Math.abs(total - agreed) < 0.005 ? "good" : "warn"}>
                  agreed {currency(agreed)}
                </Chip>
              )}
            </div>
          </div>
          <span className="font-mono text-[18px] font-bold tabular-nums text-accent">
            {currency(total)}
          </span>
        </Card>

        {/* The gap is real as soon as the screen opens — the rows prefill their
            COG from the prices agreed on the order, so this reads "$5.00
            difference" against a $115 payout on $120 of items, which is exactly
            the thing worth noticing.
            `total > 0` covers the one case where it isn't: an order taken
            without per-line prices (allowed — the intake form warns and saves
            them as $0). There the "difference" is the entire payout, an artifact
            of nothing having been priced rather than a count that disagrees, and
            stating it as a discrepancy invites somebody to correct a payout that
            was never wrong. Same fact, without the arithmetic, until there are
            numbers to do arithmetic on. */}
        {isPaid && paidGap != null && total > 0 && Math.abs(paidGap) >= 0.005 && (
          <p className="rounded-lg bg-status-awaiting-bg px-3 py-2 text-[12px] text-status-awaiting">
            Paid {currency(order.paidAmount)} on the spot — confirming records a {currency(paidGap)}{" "}
            difference to review with a payout correction. Nothing is sent automatically.
          </p>
        )}
        {isPaid && total <= 0 && (
          <p className="rounded-lg bg-accent-l px-3 py-2 text-[12px] text-accent">
            Paid {currency(order.paidAmount)} on the spot. Count what actually turned up — if the
            total lands somewhere else, you&apos;ll be offered a payout correction.
          </p>
        )}
        {!isPaid && (
          <p className="rounded-lg bg-accent-l px-3 py-2 text-[12px] text-accent">
            Confirming puts these devices in stock and prefills {currency(total)} as the payout.
          </p>
        )}
        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => router.back()}>
            Cancel
          </Button>
          <Button disabled={pending || rows.length === 0} onClick={confirm}>
            {pending ? "Saving…" : "Confirm check-in"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The buying facts, shown at the moment of the buy: FMI still ON or a
 * blacklist hit goes red WITH the consequence spelled out, because this strip
 * is what the buyer reads while deciding whether money moves — a fact shown
 * politely in grey is a fact that gets paid for. Battery is informational.
 */
function SickwFacts({ facts, name }) {
  const fmiOn = facts.fmi ? !/off/i.test(facts.fmi) : false;
  const blacklisted = facts.blacklist_status ? !/clean/i.test(facts.blacklist_status) : false;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line/60 pt-1.5 text-[11.5px]">
      {name && <span className="font-semibold text-ink">{name}</span>}
      {facts.fmi && (
        <span className={fmiOn ? "font-bold text-destructive" : "text-muted"}>
          FMI {facts.fmi}
          {fmiOn ? " — have them turn it off before paying" : ""}
        </span>
      )}
      {facts.blacklist_status && (
        <span className={blacklisted ? "font-bold text-destructive" : "text-muted"}>
          Blacklist {facts.blacklist_status}
          {blacklisted ? " — carrier-blocked" : ""}
        </span>
      )}
      {facts.battery && <span className="text-muted">Battery {facts.battery}</span>}
    </p>
  );
}

function Chip({ tone, children }) {
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-0.5 text-[10.5px] font-semibold",
        tone === "good"
          ? "bg-status-received-bg text-status-received"
          : tone === "warn"
            ? "bg-status-awaiting-bg text-status-awaiting"
            : "bg-bg text-muted ring-1 ring-inset ring-line",
      )}
    >
      {children}
    </span>
  );
}
