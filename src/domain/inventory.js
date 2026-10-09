import { orderTypeLabel } from "./orders";

/**
 * Inventory lots and invoice money math. Pure functions — no React, no I/O —
 * because every dollar figure on the inventory grid and the invoice screens
 * is DERIVED from a handful of stored facts, and deriving in one place is
 * what keeps the grid, the tiles, the invoice detail, and the exports from
 * ever disagreeing about what a device earned.
 *
 * A LOT is ONE DEVICE: an iPhone, an iPad, a sealed box. `quantity` is
 * always 1 — the column survives from the ancestor app because every piece
 * of money math multiplies by it, and a hardcoded 1 in ten places is worse
 * than a column that says 1. Identity facts are `imei` / `serial` (either
 * may be absent — a MacBook has no IMEI, a stack of sealed boxes may be
 * entered before anyone scans them), `carrier`, and `grade`. Sickw-pulled
 * facts live whole in `details` jsonb. Money facts stored on a lot are
 * `cog` (what we paid for it), `rate` (asking price, set when invoiced),
 * and `soldTotal` / `shipTotal` (written once at settle). Everything else —
 * P/L, projections — is computed here.
 */

export const LOT_STATUSES = ["in_stock", "shipped", "complete", "disposed"];

export const LOT_STATUS_LABELS = {
  in_stock: "In Stock",
  // "shipped" internally for schema continuity; most sales are local
  // handovers, so the UI says what the state means: it's on a live invoice.
  shipped: "On Invoice",
  complete: "Sold",
  disposed: "Disposed",
};

/**
 * The FALLBACK grade list. The live list is the `grades` app_settings key,
 * edited on /settings (Jaime wants grades configurable, 2026-08-13); this
 * is what a picker shows when that read fails, and the seed the setting
 * starts from. Grades are free strings in the schema — no check constraint —
 * precisely so the settings list can change without a migration.
 */
export const DEFAULT_GRADES = ["Sealed", "A", "B", "C", "Broken"];

/**
 * The fixed carrier-lock list a booking and check-in both pick from. Free
 * text would let "ATT"/"AT&T"/"at&t" become three carriers; Unlocked is its
 * own option rather than a separate checkbox, because "which carrier" and
 * "is it locked" are the same question to a buyer, not two. Not
 * settings-driven like grades — there is no business reason for this list to
 * change, and the big three cover nearly every device that crosses the
 * counter.
 */
export const CARRIERS = ["Unlocked", "AT&T", "T-Mobile", "Verizon", "Other"];

/**
 * "iPhone 15 Pro Max" + "256GB" + "Blue Titanium" — whichever of the three
 * Sickw returned, joined. Simple string assembly on purpose: the name is for
 * humans reading the grid and the buyer sheet, not for a parser.
 *
 * Shared by check-in (CheckInForm) and the admin re-check button
 * (LotEditDialog) — one mapping, so re-verifying an already-checked-in
 * device's IMEI can never produce a different name than check-in would have.
 */
export function itemNameFromSickw(fields) {
  return [fields.model, fields.storage, fields.color].filter(Boolean).join(" ");
}

/**
 * Sickw's carrier/lock wording, mapped onto the fixed CARRIERS list — free
 * text would put "10 - Unlock." in a select that can't display it. Unlock
 * verdicts ("Unlocked", "10 - Unlock.") win outright; a recognizable big-three
 * carrier maps to its spelling; any other non-empty answer is "Other".
 */
export function carrierFromSickw(fields) {
  const said = `${fields.sim_lock || ""} ${fields.carrier || ""}`.toLowerCase();
  if (!said.trim()) return "";
  if (said.includes("unlock")) return "Unlocked";
  if (/at&t|\batt\b|cingular|cricket/.test(said)) return "AT&T";
  if (/t-?mobile|sprint|metro/.test(said)) return "T-Mobile";
  if (/verizon/.test(said)) return "Verizon";
  return "Other";
}

// ---------------------------------------------------------------------------
// Money. Dollars in, dollars out; cents internally, because the shipping
// spread has to reconcile to the penny against what the buyer actually paid.
// ---------------------------------------------------------------------------

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const toDollars = (c) => c / 100;

/** What a lot cost us: per-unit COG times the units in it (always 1 today). */
export function lotCogTotal(lot) {
  return (Number(lot?.cog) || 0) * (Number(lot?.quantity) || 0);
}

/** What a lot was invoiced at. Null until invoiced. */
export function lotInvoiceTotal(lot) {
  if (lot?.rate == null) return null;
  return (Number(lot.rate) || 0) * (Number(lot.quantity) || 0);
}

/** Sum of rate × quantity across an invoice's lots — the projected payout. */
export function projectedTotal(lots = []) {
  return toDollars(lots.reduce((sum, l) => sum + toCents(l.rate) * (Number(l.quantity) || 0), 0));
}

export function unitCount(lots = []) {
  return lots.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
}

/**
 * Spread the invoice-level costs onto the lots at settle time.
 *
 * Settling is PER LINE here (each device gets the actual price it sold for —
 * a 17 Pro Max and an SE do not split a shortfall evenly, per Jaime
 * 2026-08-13), so unlike the ancestor app this function no longer allocates
 * a one-number payment. What still needs spreading is SHIPPING, when there
 * is any: it is paid per box, not per device, and each unit carries an even
 * share. Splitting in cents leaves a remainder of at most units−1 cents; it
 * rides the LAST lot so the shares always sum exactly to the shipping paid,
 * and nobody reconciles a phantom penny.
 *
 * @param {Array<{id: string, quantity: number}>} lots
 * @param {number} shipping dollars it cost us to ship the box (0 for local)
 * @returns {Map<string, number>} lot id -> shipTotal dollars
 */
export function shippingAllocations(lots, shipping) {
  const units = unitCount(lots);
  const out = new Map();
  if (!units) return out;

  const shipCents = toCents(shipping);
  const shipPerUnit = Math.trunc(shipCents / units);

  let spent = 0;
  lots.forEach((lot, i) => {
    const qty = Number(lot.quantity) || 0;
    const last = i === lots.length - 1;
    const share = last ? shipCents - spent : shipPerUnit * qty;
    spent += share;
    out.set(lot.id, toDollars(share));
  });
  return out;
}

/**
 * A lot's profit/loss, or null while the money isn't settled yet.
 *
 * Computed, never stored: complete lots earned soldTotal minus their
 * shipping share minus what we paid for them; a disposed lot is its COG
 * written off. In-stock and invoiced lots have no P/L yet — showing a
 * projection as profit is how a spreadsheet lies to you.
 */
export function lotPL(lot) {
  if (lot?.status === "complete") {
    return (
      (Number(lot.soldTotal) || 0) -
      (Number(lot.shipTotal) || 0) -
      // Marketplace fees (eBay). Null on wholesale invoice sales — a buyer
      // wire has no platform between the money and us.
      (Number(lot.feeTotal) || 0) -
      lotCogTotal(lot)
    );
  }
  if (lot?.status === "disposed") return -lotCogTotal(lot);
  return null;
}

/**
 * A sale that never went through an invoice — eBay and whatever channel comes
 * next. THE test for it, everywhere: `complete` with no invoice. Screens must
 * not branch on soldChannel alone (a channel with an invoice id would be an
 * invoice sale that happens to be labeled).
 */
export function isDirectSale(lot) {
  return lot?.status === "complete" && !lot?.invoiceId;
}

// ---------------------------------------------------------------------------
// Lifecycle rules — where the locks are.
// ---------------------------------------------------------------------------

/** Facts are correctable only while the lot is ours alone. */
export function canEditLot(lot) {
  return lot?.status === "in_stock";
}

/** Only unsold stock can be written off. */
export function canDisposeLot(lot) {
  return lot?.status === "in_stock";
}

/**
 * A lot that stops its ORDER being deleted: on an invoice, or sold.
 *
 * Deleting an order removes its devices from inventory, and a device that is
 * already a line on a buyer's invoice (or a recorded eBay sale) is part of a
 * money document — pulling it out from under the invoice would change what
 * the buyer was billed for without a trace. The way through is the one the
 * invoice already offers: void it (or undo the direct sale), which returns
 * the lots to stock, and then the delete goes. In-stock and disposed lots
 * are the order's alone and go with it.
 */
export function blocksOrderDelete(lot) {
  return lot?.status === "shipped" || lot?.status === "complete";
}

/**
 * Void unwinds a SENT invoice — lots return to stock, the number stays
 * burned. A settled invoice is a record of money that moved; unwinding that
 * is a correction conversation, not a button.
 */
export function canVoidInvoice(invoice) {
  return invoice?.status === "shipped";
}

export function canSettleInvoice(invoice) {
  return invoice?.status === "shipped";
}

/** INV-0007 is formatting; the stored number is a plain integer. */
export function invoiceNumber(n) {
  return `INV-${String(n ?? 0).padStart(4, "0")}`;
}

/**
 * An invoice's realized P/L: what cleared, minus shipping, minus what its
 * lots cost us. Null until settled — a projection shown as profit is how a
 * spreadsheet lies to you.
 */
export function invoicePL(invoice) {
  if (invoice?.status !== "complete" || invoice.paid == null) return null;
  const cog = (invoice.lots || []).reduce((sum, lot) => sum + lotCogTotal(lot), 0);
  return invoice.paid - (invoice.shipping || 0) - cog;
}

// ---------------------------------------------------------------------------
// Grouping. Lots are stored ONE PER DEVICE, and a device with an IMEI is
// always its own line — buyers buy serials, and a manifest that says
// "3 × iPhone 15 Pro Max" with no IMEIs is a manifest nobody can check a
// box against. Only identity-less units (sealed stock entered before
// scanning) collapse into quantity lines.
// ---------------------------------------------------------------------------

/**
 * An invoice's document lines. IMEI/serial devices stay individual;
 * identity-less lots group by (item, carrier, grade, rate) with a quantity.
 * Money fields are summed; P/L only exists once every unit in the line has
 * one.
 */
export function invoiceLines(lots = []) {
  const lines = new Map();
  for (const lot of lots) {
    const identity = lot.imei || lot.serial || null;
    const key = identity
      ? `id:${lot.id}`
      : [lot.item, lot.carrier ?? "", lot.grade ?? "", lot.rate ?? ""].join("|");
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        item: lot.item,
        imei: identity ? (lot.imei ?? undefined) : undefined,
        serial: identity ? (lot.serial ?? undefined) : undefined,
        carrier: lot.carrier,
        grade: lot.grade,
        rate: lot.rate,
        quantity: 0,
        cogTotal: 0,
        invoiceTotal: 0,
        soldTotal: 0,
        shipTotal: 0,
        pl: 0,
        settled: true,
      };
      lines.set(key, line);
    }
    line.quantity += Number(lot.quantity) || 0;
    line.cogTotal += lotCogTotal(lot);
    line.invoiceTotal += lotInvoiceTotal(lot) || 0;
    line.soldTotal += Number(lot.soldTotal) || 0;
    line.shipTotal += Number(lot.shipTotal) || 0;
    const pl = lotPL(lot);
    if (pl == null) line.settled = false;
    else line.pl += pl;
  }
  return [...lines.values()];
}

/**
 * Group in-stock lots for the invoice builder's pick list: same item,
 * carrier, grade, and COG → one pickable group. Devices with an IMEI are
 * still individually listed inside the group (the picker shows them), and
 * units inside a group sell oldest-first.
 */
export function stockGroups(lots = []) {
  const groups = new Map();
  for (const lot of lots) {
    const key = [lot.item, lot.carrier ?? "", lot.grade ?? "", lot.cog].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        item: lot.item,
        carrier: lot.carrier,
        grade: lot.grade,
        cog: lot.cog,
        orderNames: new Set(),
        lots: [],
      };
      groups.set(key, group);
    }
    group.lots.push(lot);
    if (lot.order?.name) group.orderNames.add(lot.order.name);
  }
  for (const group of groups.values()) {
    group.lots.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// The check-in queue.
// ---------------------------------------------------------------------------

/**
 * Orders whose physical devices haven't been counted yet. Status is NOT the
 * gate — an in-person order is often paid on the spot before anyone scans an
 * IMEI, so paid orders queue too and their check-in is the after-the-fact
 * audit. Cancelled orders never had contents to count.
 */
export function needsCheckIn(order) {
  return (order?.status === "received" || order?.status === "paid") && !order?.checkedInAt;
}

export function isCheckedIn(order) {
  return Boolean(order?.checkedInAt);
}

/**
 * How the devices reached us, in the grid's vocabulary. Derived from the
 * order rather than re-entered per lot.
 */
export function lotSourceLabel(order) {
  return orderTypeLabel(order);
}

// ---------------------------------------------------------------------------
// Exports — the bridge to the Google Sheet the buyers actually read.
// The whole point of the columns below is that they paste into the existing
// shared sheet without anyone reordering anything (Jaime, 2026-08-13).
// ---------------------------------------------------------------------------

/** The shared-sheet column order. Do not reorder without changing the sheet. */
export const SHEET_EXPORT_HEADERS = ["IMEI", "Items", "Carrier", "Grade", "Price Sold"];

/**
 * One export row per lot, in SHEET_EXPORT_HEADERS order. Price is what the
 * device actually sold for when settled, the asking rate while invoiced,
 * and blank in stock — the sheet's own convention: a price appears when
 * there is one to report.
 */
export function sheetExportRows(lots = []) {
  return lots.map((lot) => [
    lot.imei ?? lot.serial ?? "",
    lot.item ?? "",
    lot.carrier ?? "",
    lot.grade ?? "",
    lot.soldTotal ?? lot.rate ?? "",
  ]);
}

/**
 * The GRID's copy shape (Jaime, 2026-08-13; reshaped 2026-10-03 to match the
 * buy-log sheet's actual columns) — a different document from the buyer
 * sheet above: no header row (the sheet has its own), one row per device,
 * EIGHT columns — Inventory, Date, IMEI, Items, Carrier, Grade, Payment
 * Method, COG.
 *
 *   Inventory — always the literal word "Inventory": every row this export
 *               produces is a device just bought in, so it starts in that
 *               status. The sheet's own dropdown is how a row moves on from
 *               there; this export never revisits a row it already wrote.
 *   Date       — the DEVICE's own check-in date (`lot.createdAt`), not when
 *               this export ran, so a batch spanning days keeps each row's
 *               real date instead of relabeling everything "today."
 *   Items      — Sickw's factory descriptor
 *               ("IPHONE 17 PRO MAX,NAUS,256GB,ORG") over the catalog base
 *               name because the sheet identifies devices by the full
 *               string; hand-typed devices fall back to the catalog name.
 *   Payment Method — how the CUSTOMER was paid (the order's payment method).
 *   COG        — what WE paid for the device (`lot.cog`), known the moment
 *               it's checked in and therefore never blank. Deliberately NOT
 *               `soldTotal`/`rate` — that is the sale-side price to whoever
 *               buys the device from us later, a different number this
 *               sheet never asks for.
 */
export function sheetCopyRows(lots = []) {
  const p = (n) => String(n).padStart(2, "0");
  return lots.map((lot) => {
    // Same alias thinking as lib/sickw: services spell the factory string
    // differently; take the first spelling present.
    const d = lot.details ?? {};
    const descriptor = d.model_description ?? d.model_desc ?? d.description ?? lot.item ?? "";
    const date = new Date(lot.createdAt ?? Date.now());
    return [
      "Inventory",
      `${p(date.getMonth() + 1)}/${p(date.getDate())}/${date.getFullYear()}`,
      lot.imei ?? lot.serial ?? "",
      descriptor,
      lot.carrier ?? "",
      lot.grade ?? "",
      lot.order?.paymentMethod ?? "",
      `$${Number(lot.cog ?? 0).toFixed(2)}`,
    ];
  });
}

/**
 * RFC-4180ish: every field quoted, quotes doubled, rows joined with \n.
 * `headers` is optional — omit it (null/undefined) for a sheet whose target
 * already has its own header row, like the buy-log paste.
 */
export function buildCsv(headers, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => r.map(q).join(","));
  return (headers ? [headers.map(q).join(","), ...lines] : lines).join("\n");
}

/**
 * Tab-separated, for the clipboard: paste lands one value per cell in
 * Google Sheets with no import dialog. Tabs/newlines inside values become
 * spaces — TSV has no quoting convention a spreadsheet respects, and a
 * device name will never miss them. `headers` is optional, same as buildCsv.
 */
export function buildTsv(headers, rows) {
  const clean = (v) => String(v ?? "").replace(/[\t\n\r]+/g, " ");
  return (headers ? [headers, ...rows] : rows).map((r) => r.map(clean).join("\t")).join("\n");
}
