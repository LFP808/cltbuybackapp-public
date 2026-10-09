import { encodeCode128 } from "./barcode";

/**
 * The 4 x 2 inch device label: condition, barcode, IMEI, device type.
 *
 * Shapes one lot into what the label prints; the page only lays it out. One
 * place, so the label a VA prints from the grid and the one printed from an
 * order page say the same thing in the same order.
 *
 * WHAT'S ON IT, AND WHY:
 *   condition  — the lot's grade. "Grade" and "condition" are one ladder in
 *                this app (the `grades` setting): what the customer says at
 *                booking seeds it, what check-in decides is what the label
 *                carries. Big, because it is what a buyer or a sorter reads
 *                from across the bench.
 *   barcode    — the IMEI (or the serial when there is no IMEI), Code 128, so
 *                a wedge scanner types the identity into the check-in field,
 *                the grid search, or a buyer's sheet.
 *   imei       — in digits under the bars, for the day the scanner is dead.
 *   device     — the item name as the lot knows it, which after a Sickw lookup
 *                is the full descriptor ("iPhone 15 Pro Max 256GB Blue").
 */

/** The label size, in inches — the printer's 4 x 2 (100 x 50 mm) stock. */
export const LABEL_WIDTH_IN = 4;
export const LABEL_HEIGHT_IN = 2;

/** Ceiling on one print job: a sheet of hundreds is a mis-click, not a run. */
export const MAX_LABELS = 200;

/**
 * @param {import('./types').Lot} lot
 * @returns {{ id: string, device: string, condition: string, carrier: string,
 *   code: string, codeKind: "imei"|"serial"|null, barcode: {modules: string}|null }}
 */
export function labelFor(lot) {
  const imei = String(lot?.imei || "").trim();
  const serial = String(lot?.serial || "").trim();
  const code = imei || serial;
  const codeKind = imei ? "imei" : serial ? "serial" : null;
  return {
    id: lot.id,
    device: String(lot?.item || "").trim() || "Device",
    condition: String(lot?.grade || "").trim(),
    carrier: String(lot?.carrier || "").trim(),
    code,
    codeKind,
    // Null when there is nothing to encode (no identity recorded) or the
    // identity holds a character Code 128 can't carry; the label then prints
    // the text alone and says so, rather than a barcode that scans wrong.
    barcode: code ? encodeCode128(code) : null,
  };
}

/** Labels for a batch, in the order given, capped at MAX_LABELS. */
export function labelsFor(lots = []) {
  return lots.slice(0, MAX_LABELS).map(labelFor);
}
