"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
// canWrite gates the stock actions (a VA reads the sheet, changes nothing);
// canAccess still gates the catalog ones, which hang off /pricing.
import { canAccess, canWrite } from "@/domain/access";
import { currency } from "@/domain/format";
import { getOrder, claimCheckIn, releaseCheckIn } from "@/lib/repositories/orders";
import {
  createLots,
  getLot,
  updateLotFacts,
  deleteLot,
  disposeLot,
  sellLotDirect,
  undoDirectSale,
} from "@/lib/repositories/inventory";
import { addCatalogItem, setCatalogItemActive } from "@/lib/repositories/catalog";
import { sickwLookup } from "@/lib/sickw/client";
import { needsCheckIn } from "@/domain/inventory";

/**
 * Server actions for intake check-in and inventory lots. Same contract as
 * every action file: EXPECTED FAILURES ARE RETURNED via fail(), throwing is
 * reserved for genuine faults (see app/employee/actions.js for the long
 * version of why).
 *
 * Middleware already gates /inventory by role, but an action is a public
 * POST endpoint in its own right, so each one re-checks the same
 * ROUTE_ACCESS rule it is reachable from — the gate and the door match.
 *
 * sickwLookupAction's own deadline is SICKW_TIMEOUT_MS (50s, see
 * lib/sickw/client.js) — a "use server" file may only export async
 * functions, so the matching `maxDuration` that keeps Vercel's platform
 * cutoff from killing the function first lives on every PAGE that renders a
 * component calling this action instead (check-in's page and /inventory's).
 */

// Loose on purpose: an IMEI is 15 digits, but MEIDs and typed-with-checkdigit
// variants exist, and refusing a device at the counter over format is worse
// than storing what is printed on it. Digits only, sane length.
const IMEI_RE = /^\d{14,17}$/;

/** Validate + normalize one check-in row; returns { error } or { row }. */
function cleanRow(input) {
  const item = String(input?.item || "").trim();
  if (!item) return { error: "Every row needs an item." };

  const quantity = Number(input?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: `“${item}”: quantity must be a whole number of devices.` };
  }

  const imei = String(input?.imei || "").replace(/\s+/g, "");
  if (imei && !IMEI_RE.test(imei)) {
    return { error: `“${item}”: an IMEI is 14-17 digits.` };
  }
  // One IMEI names ONE device, so a row carrying it cannot also mean "three
  // of them" — the expansion below would mint duplicates the unique index
  // then rejects, one confusing row at a time.
  if (imei && quantity > 1) {
    return { error: `“${item}”: a row with an IMEI is one device — add the others as rows.` };
  }

  const serial = String(input?.serial || "").trim();
  const carrier = String(input?.carrier || "").trim();

  const grade = String(input?.grade || "").trim();
  if (!grade) return { error: `“${item}”: pick a grade.` };

  const cog = Number(input?.price);
  if (!Number.isFinite(cog) || cog < 0) {
    return { error: `“${item}”: enter the price paid (0 is fine).` };
  }

  return {
    row: {
      item,
      category: String(input?.category || "").trim() || null,
      quantity,
      imei: imei || null,
      serial: serial || null,
      carrier: carrier || null,
      grade,
      // Sickw-pulled facts ride along whole; the lookup is the only writer.
      details:
        input?.details && typeof input.details === "object" && !Array.isArray(input.details)
          ? input.details
          : {},
      cog: Math.round(cog * 100) / 100,
      notOnOrder: Boolean(input?.notOnOrder),
    },
  };
}

/**
 * Confirm a check-in: write the counted rows as inventory lots and stamp the
 * order. One tap on the screen, two writes here — the claim goes FIRST so a
 * double-confirm has one winner and the loser inserts no lots.
 *
 * Returns the money facts the screen acts on next: the check-in total (the
 * payout prefill) and, for an order already paid on the spot, the gap
 * between what was paid and what actually turned up.
 */
/**
 * Close a check-in that has nothing to count.
 *
 * The queue is "received or paid, and not yet checked in", and the only way
 * out was to record at least one device — so an order that turned out to have
 * nothing usable, or that was paid on the spot with nothing left
 * to count sat at the top of an oldest-first list for ever. A paid order can't
 * even be cancelled, so there was no exit at all.
 *
 * Stamps the same checked_in_at every real check-in sets, with a reason on the
 * activity trail — the queue is cleared by recording what happened, never by
 * hiding the row.
 */
export async function closeCheckInAction(orderId, reason) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't check in inventory.");

  const order = await getOrder(orderId);
  if (!order) return fail("Order not found.");
  if (order.checkedInAt) return fail("This order was already checked in.");
  if (!needsCheckIn(order)) {
    return fail("This order hasn't been received yet — mark it received first.");
  }

  const why = String(reason || "").trim();
  if (!why) return fail("Say why there's nothing to check in — it's the only record of it.");

  const activity = [
    ...(order.activity || []),
    { action: `Check-in closed with nothing counted - ${why}`, by: staff.name, at: Date.now() },
  ];

  const claimed = await claimCheckIn(orderId, activity);
  if (!claimed) return fail("Someone else just checked this order in.");

  revalidatePath("/employee/inventory");
  revalidatePath(`/employee/orders/${orderId}`);
}

/**
 * Ask Sickw about one device mid check-in. Gated like the check-in it serves —
 * in live mode every hit spends real money from the prepaid Sickw balance, so
 * this must not be a free endpoint for anyone with a session. Sickw's own
 * refusals (bad IMEI, empty balance, downtime) come back as returned
 * failures; the form shows them beside the button and manual entry carries on.
 */
export async function sickwLookupAction(imei) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory/check-in")) return fail("You can't check in inventory.");

  const result = await sickwLookup(imei);
  if (!result.ok) return fail(result.error);
  // `raw` rides back whole so the row can persist it as details jsonb — the
  // full report is the audit of what Sickw said the day we bought the device.
  return { fields: result.fields, raw: result.raw };
}

export async function confirmCheckInAction(orderId, inputRows) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't check in inventory.");

  const order = await getOrder(orderId);
  if (!order) return fail("Order not found.");
  if (order.checkedInAt) return fail("This order was already checked in.");
  if (!needsCheckIn(order)) {
    return fail("This order hasn't been received yet — mark it received first.");
  }

  // EVERY DEVICE ITS OWN ROW (Jaime): the form's quantity is an entry
  // shortcut, and it expands here — "3 of them" becomes three unit lots, so
  // the grid, invoicing, and the spread math all work device-by-device with
  // no splitting. (A row with an IMEI is always quantity 1 — see cleanRow.)
  const rows = [];
  for (const input of Array.isArray(inputRows) ? inputRows : []) {
    const { error, row } = cleanRow(input);
    if (error) return fail(error);
    for (let i = 0; i < row.quantity; i += 1) {
      rows.push({ ...row, quantity: 1 });
    }
  }
  if (!rows.length) {
    return fail("Nothing to check in — add at least one row.");
  }
  if (rows.length > 500) {
    return fail("That's over 500 devices in one go — split the check-in.");
  }

  const units = rows.length;
  const total = Math.round(rows.reduce((sum, r) => sum + r.cog * r.quantity, 0) * 100) / 100;

  // For an order paid on the spot, check-in is the audit: surface the gap
  // between the payout and what was actually counted. The correction itself
  // stays a human decision on the order page — recorded here, never auto-sent.
  const paidGap =
    order.status === "paid" && order.paidAmount != null
      ? Math.round((total - order.paidAmount) * 100) / 100
      : null;

  const activity = [
    ...(order.activity || []),
    {
      action: `Checked in ${units} item${units === 1 ? "" : "s"} — ${currency(total)}`,
      by: staff.name,
      at: Date.now(),
    },
    ...(paidGap
      ? [
          {
            action: `Check-in total differs from the ${currency(order.paidAmount)} payout by ${currency(paidGap)} — review with a payout correction`,
            by: staff.name,
            at: Date.now(),
          },
        ]
      : []),
  ];

  // CLAIM FIRST, for the concurrency it is there for: two staffers counting the
  // same device would otherwise both create lots, and their counts need not agree.
  // The claim picks one winner. But it stamps the order and drops it from the
  // queue before the lots exist, so if the insert then fails the order is stuck
  // checked-in with no inventory - so the claim is rolled back on failure and
  // the order returns to Pending to be tried again. createLots is a single
  // insert (all-or-nothing), so there are never half-made lots to clean up.
  const claimed = await claimCheckIn(orderId, activity);
  if (!claimed) return fail("Someone else already checked this order in.");

  try {
    await createLots(
      rows.map((row) => ({
        ...row,
        orderId,
        // Who did the BUY (stamped on the order at Mark bought / walk-in
        // creation), copied per lot so per-person P/L never joins back to
        // orders. Falls back to the counter for orders that predate the
        // column — an approximation, but the two are usually the same person.
        boughtBy: order.boughtBy ?? staff.name,
        checkedInBy: staff.name,
      })),
    );
  } catch (err) {
    // Put the order back the way it was, so the count can be re-entered. The
    // rollback's own failure is the rare-squared case; log it loudly because
    // then, and only then, is a hand repair actually needed.
    await releaseCheckIn(orderId, order.activity).catch((e) =>
      console.error(`Check-in rollback failed for ${orderId}:`, e?.message || e),
    );
    console.error(`Check-in lot creation failed for ${orderId}:`, err?.message || err);
    return fail("Couldn't save the check-in - nothing was recorded, please try again.");
  }

  revalidatePath("/employee/inventory");
  revalidatePath(`/employee/orders/${orderId}`);
  revalidatePath("/employee");
  return { total, units, paidGap };
}

/**
 * Correct an in-stock lot's facts, logging who changed what. The repository
 * guard means a lot invoiced mid-edit comes back null — locked, not lost.
 *
 * ADMIN ONLY (Jaime, 2026-10-03) — unlike the rest of /inventory, which both
 * roles write (check-in, dispose, a direct sale). Retyping an already-booked
 * fact is exactly the kind of change the edits log exists to be asked about
 * later, and that accountability is the point of restricting who can make
 * it, not just recording that it happened.
 */
export async function updateLotFactsAction(id, patch) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can edit a device's facts.");

  const lot = await getLot(id);
  if (!lot) return fail("Lot not found.");
  if (lot.status !== "in_stock") {
    return fail("This lot is on an invoice — its facts are locked.");
  }

  const clean = {};
  if ("item" in patch) {
    const item = String(patch.item || "").trim();
    if (!item) return fail("The item needs a name.");
    clean.item = item;
  }
  if ("imei" in patch) {
    const imei = String(patch.imei || "").replace(/\s+/g, "");
    if (imei && !IMEI_RE.test(imei)) return fail("An IMEI is 14-17 digits.");
    clean.imei = imei || null;
  }
  if ("serial" in patch) {
    clean.serial = String(patch.serial || "").trim() || null;
  }
  if ("carrier" in patch) {
    clean.carrier = String(patch.carrier || "").trim() || null;
  }
  if ("grade" in patch) {
    const grade = String(patch.grade || "").trim();
    if (!grade) return fail("Pick a grade.");
    clean.grade = grade;
  }
  if ("cog" in patch) {
    const cog = Number(patch.cog);
    if (!Number.isFinite(cog) || cog < 0) return fail("Enter a valid price paid.");
    clean.cog = Math.round(cog * 100) / 100;
  }
  // No quantity here on purpose: a lot IS one physical device (check-in
  // expands quantities), so "more of them" is a new check-in row, not an edit.
  if (!Object.keys(clean).length && !("details" in patch)) return fail("Nothing to change.");

  // The audit trail: was → is, per field, so a corrected fact stays
  // explainable. `details` (Sickw's whole re-looked-up report) is NOT
  // diffed here — a jsonb blob has no readable "was X, now Y" line, and the
  // scalar fields above (item/carrier/grade/...) already say what changed
  // as a RESULT of a re-check. Added to `clean` after this diff so it never
  // pollutes the human-readable log.
  const edits = Object.entries(clean)
    .filter(([field, value]) => (lot[field] ?? null) !== value)
    .map(([field, value]) => ({
      at: Date.now(),
      by: staff.name,
      field,
      from: lot[field] ?? null,
      to: value,
    }));
  if ("details" in patch) clean.details = patch.details || {};

  const updated = await updateLotFacts(id, clean, edits);
  if (!updated) return fail("This lot was invoiced while you were editing — facts are locked.");

  revalidatePath("/employee/inventory");
  return { ok: true };
}

/** Remove a mistaken lot. In-stock only; the guard reports, not corrupts. */
export async function deleteLotAction(id) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't edit inventory.");

  const removed = await deleteLot(id);
  if (!removed) return fail("This lot is on an invoice — it can't be deleted.");

  revalidatePath("/employee/inventory");
  return { ok: true };
}

/** Write off unsold stock. Its P/L becomes −COG, derived like everything else. */
export async function disposeLotAction(id, note) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't edit inventory.");

  const lot = await disposeLot(id, String(note || "").trim());
  if (!lot) return fail("Only in-stock lots can be disposed.");

  revalidatePath("/employee/inventory");
  return { ok: true };
}

/**
 * Sell one in-stock device on eBay: sold price, the platform's fees, and the
 * label cost, recognized on the date given (defaults to today on the form).
 * No invoice — the lot goes straight to complete with the channel recorded,
 * and every money screen derives from the same columns a settle writes.
 */
export async function sellLotDirectAction(id, input) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't edit inventory.");

  const lot = await getLot(id);
  if (!lot) return fail("Lot not found.");
  if (lot.status !== "in_stock") return fail("Only in-stock devices can be sold.");

  const soldTotal = Number(input?.soldTotal);
  if (!Number.isFinite(soldTotal) || soldTotal <= 0) {
    return fail("Enter what it sold for.", {
      fieldErrors: { soldTotal: "Enter what it sold for." },
    });
  }
  const feeTotal = input?.feeTotal === "" || input?.feeTotal == null ? 0 : Number(input.feeTotal);
  if (!Number.isFinite(feeTotal) || feeTotal < 0) return fail("Fees must be zero or more.");
  const shipTotal = input?.shipTotal === "" || input?.shipTotal == null ? 0 : Number(input.shipTotal);
  if (!Number.isFinite(shipTotal) || shipTotal < 0) return fail("Shipping must be zero or more.");
  // Fees eating the whole sale is almost always a typo (fees field holding
  // the sold price); refusing beats recording a sale that made negative money
  // by accident. A genuine total loss is a Dispose, not a sale.
  if (feeTotal + shipTotal >= soldTotal) {
    return fail("Fees plus shipping are as much as the sale — check the numbers.");
  }
  const soldAt = input?.soldAt ? new Date(`${input.soldAt}T12:00:00`).getTime() : Date.now();
  if (!Number.isFinite(soldAt)) return fail("Pick a valid sale date.");

  const sold = await sellLotDirect(
    id,
    {
      soldTotal: Math.round(soldTotal * 100) / 100,
      feeTotal: Math.round(feeTotal * 100) / 100,
      shipTotal: Math.round(shipTotal * 100) / 100,
      soldChannel: "eBay",
      soldAt,
    },
    {
      at: Date.now(),
      by: staff.name,
      field: "status",
      from: "in_stock",
      to: "complete (eBay)",
    },
  );
  if (!sold) return fail("This device was invoiced or removed while you were selling it.");

  revalidatePath("/employee/inventory");
  revalidatePath("/employee/pl");
  return { ok: true };
}

/** Reverse a mistaken eBay sale — the undo an invoice sale gets via Void. */
export async function undoDirectSaleAction(id) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/inventory")) return fail("You can't edit inventory.");

  const undone = await undoDirectSale(id, {
    at: Date.now(),
    by: staff.name,
    field: "status",
    from: "complete (eBay)",
    to: "in_stock",
  });
  if (!undone) return fail("Only a direct (eBay) sale can be undone here — invoices use Void.");

  revalidatePath("/employee/inventory");
  revalidatePath("/employee/pl");
  return { ok: true };
}

/**
 * Add an off-list item to the catalog (a device the picker doesn't know yet
 * should be one add away). Gated like the catalog page itself — /pricing is
 * admin-only, and what we buy is part of what we pay.
 */
export async function addCatalogItemAction({ name, category }) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/pricing")) return fail("You can't edit the catalog.");

  const cleanName = String(name || "").trim();
  const cleanCategory = String(category || "").trim();
  if (!cleanName) return fail("The item needs a name.");
  if (!cleanCategory) return fail("Pick or type a category.");

  const item = await addCatalogItem({ name: cleanName, category: cleanCategory });
  if (!item) return fail("An item with that exact name already exists.");

  revalidatePath("/employee/pricing");
  revalidatePath("/employee/new");
  return { item };
}

/** Retire an item from the picker without erasing what history means by it. */
export async function setCatalogItemActiveAction(id, active) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/pricing")) return fail("You can't edit the catalog.");

  await setCatalogItemActive(id, Boolean(active));
  revalidatePath("/employee/pricing");
  revalidatePath("/employee/new");
  return { ok: true };
}
