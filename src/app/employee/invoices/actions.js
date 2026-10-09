"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
// canWrite, not canAccess: the mechanism outlives its entries. READ_ONLY_AREAS
// is empty today (the VA builds and settles invoices), but actions keep asking
// canWrite so tightening access later is one table edit, not an action audit.
import { canWrite } from "@/domain/access";
import { currency } from "@/domain/format";
import {
  listLotsInStock,
  markLotsShipped,
  revertLotsToStock,
  settleLots,
  unsettleLots,
  reallocateLots,
} from "@/lib/repositories/inventory";
import {
  createInvoice,
  getInvoice,
  settleInvoice,
  unsettleInvoice,
  correctInvoiceSettlement,
  voidInvoice,
  unvoidInvoice,
  deleteEmptyInvoice,
} from "@/lib/repositories/invoices";
import { createBuyer, getBuyer, updateBuyer } from "@/lib/repositories/buyers";
import {
  invoiceLines,
  shippingAllocations,
  canSettleInvoice,
  canVoidInvoice,
} from "@/domain/inventory";

/**
 * Server actions for invoices — the only place stock becomes money. Expected
 * failures are RETURNED via fail(); see app/employee/actions.js for why.
 *
 * There are no transactions over PostgREST, so the multi-table sequences claim
 * first (a compare-and-swap picks one winner) and then roll the claim back if
 * the second write fails - the invoice returns to the status it had, so no
 * settle or void can leave lots stranded where the app can't reach them. The
 * claim also loses cleanly to a concurrent settle/void, which a plain reorder
 * would not. See settleInvoiceAction and voidInvoiceAction.
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

const toCents = (n) => Math.round((Number(n) || 0) * 100);

/** Stable settle order (created_at, then id) so any per-unit penny remainder lands on the same lot no matter who runs the math. */
function stableLots(lots, status) {
  return (lots || [])
    .filter((lot) => lot.status === status)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/**
 * Create an invoice from in-stock lots and mark them shipped.
 *
 * @param {object} input
 * @param {string} [input.buyerId] an existing buyer…
 * @param {object} [input.newBuyer] …or a new one ({ name, street, …, terms })
 * @param {Array<{lotId: string, rate: number}>} input.picks per-unit rates
 */
export async function createInvoiceAction({ buyerId, newBuyer, shipping, note, picks }) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/invoices")) return fail("You can't create invoices.");

  const cleanPicks = [];
  const seen = new Set();
  for (const pick of Array.isArray(picks) ? picks : []) {
    if (!pick?.lotId || seen.has(pick.lotId)) continue;
    seen.add(pick.lotId);
    const rate = Number(pick.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      return fail("Every line needs a per-unit invoice price (0 is fine).");
    }
    cleanPicks.push({ id: pick.lotId, rate: round2(rate) });
  }
  if (!cleanPicks.length) return fail("Pick at least one lot from stock.");

  const shipCost = Number(shipping || 0);
  if (!Number.isFinite(shipCost) || shipCost < 0) return fail("Enter a valid shipping cost.");

  // Resolve the buyer — existing from the dropdown, or created inline so a
  // first sale to someone new is one screen, not two.
  let buyer = null;
  if (newBuyer?.name?.trim()) {
    buyer = await createBuyer(
      {
        name: newBuyer.name.trim(),
        street: newBuyer.street?.trim() || null,
        street2: newBuyer.street2?.trim() || null,
        city: newBuyer.city?.trim() || null,
        state: newBuyer.state?.trim() || null,
        zip: newBuyer.zip?.trim() || null,
        terms: newBuyer.terms?.trim() || null,
      },
      staff.name,
    );
  } else if (buyerId) {
    buyer = await getBuyer(buyerId);
  }
  if (!buyer) return fail("Pick a buyer or enter a new one.");

  // Projected is computed here from the lots' real quantities — the client
  // sent rates, never totals, for the same reason estValue is recomputed at
  // order intake: it's money, and the client can say anything.
  const inStock = new Map((await listLotsInStock()).map((lot) => [lot.id, lot]));
  let projected = 0;
  for (const pick of cleanPicks) {
    const lot = inStock.get(pick.id);
    if (!lot) {
      return fail("Some picked items were sold or changed — refresh stock and try again.");
    }
    projected += pick.rate * lot.quantity;
  }
  projected = round2(projected);

  const invoice = await createInvoice({
    buyerId: buyer.id,
    projected,
    shipping: round2(shipCost),
    note: String(note || "").trim() || null,
    createdBy: staff.name,
  });

  // Each lot moves in_stock → shipped under a per-lot guard. Anything that
  // raced away comes back missing from `shipped`; the whole invoice unwinds
  // rather than shipping half a document.
  const shipped = await markLotsShipped(cleanPicks, invoice.id);
  if (shipped.length !== cleanPicks.length) {
    await revertLotsToStock(shipped);
    await deleteEmptyInvoice(invoice.id);
    return fail("Some picked items were sold or changed — refresh stock and try again.");
  }

  revalidatePath("/employee/invoices");
  revalidatePath("/employee/inventory");
  return { id: invoice.id, number: invoice.number };
}

/**
 * Settle a SENT invoice with what each device ACTUALLY sold for.
 *
 * The form submits per-LINE per-unit prices — a grouped identity-less line is
 * one price that applies to every device in it — and the expansion to lots
 * happens HERE, in cents, so the stored per-lot totals sum exactly to the
 * paid figure with no float dust. `paid` is never an input: it is the sum of
 * the actuals, computed then stored, so the invoice header cannot disagree
 * with its own lines. Shipping (usually 0 — most sales are local handovers)
 * still spreads evenly per unit via shippingAllocations when present.
 *
 * @param {string} id
 * @param {object} input
 * @param {Array<{key: string, price: number}>} input.lines per-UNIT actuals,
 *   keyed by the invoiceLines() line key the form rendered from
 * @param {number} [input.shipping] actual cost to ship the box, dollars
 * @param {string} [input.paidMethod]
 * @param {string} [input.paidDate] YYYY-MM-DD
 */
export async function settleInvoiceAction(id, { lines, shipping, paidMethod, paidDate }) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/invoices")) return fail("You can't settle invoices.");

  const shipCost = Number(shipping ?? 0);
  if (!Number.isFinite(shipCost) || shipCost < 0) {
    return fail("Enter a valid shipping cost (0 is fine).");
  }

  // Per-unit actuals in cents, by line key. Validated before anything moves.
  const priceByKey = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const price = Number(line?.price);
    if (!line?.key || !Number.isFinite(price) || price < 0) {
      return fail("Every line needs the actual price it sold for (0 is fine).");
    }
    priceByKey.set(line.key, toCents(price));
  }
  if (!priceByKey.size) return fail("Nothing to settle.");

  const invoice = await getInvoice(id);
  if (!invoice) return fail("Invoice not found.");
  if (!canSettleInvoice(invoice)) {
    return fail(
      invoice.status === "complete"
        ? "This invoice is already settled."
        : "A voided invoice can't be settled.",
    );
  }

  const lots = stableLots(invoice.lots, "shipped");
  if (!lots.length) return fail("This invoice has no devices to settle.");

  // Coverage both ways: every document line must be priced (no lot settles
  // without an actual), and every submitted key must still be a line (a
  // mismatch means the form was rendered from different lots than the ones
  // about to be written — refresh, don't guess).
  const docKeys = new Set(invoiceLines(lots).map((line) => line.key));
  for (const key of docKeys) {
    if (!priceByKey.has(key)) {
      return fail("Every device needs an actual price — refresh and try again.");
    }
  }
  for (const key of priceByKey.keys()) {
    if (!docKeys.has(key)) {
      return fail("This invoice changed while you were typing — refresh and try again.");
    }
  }

  // Expand lines to lots. A lot's line key comes from invoiceLines itself —
  // run over a single lot it yields that lot's line — so the expansion here
  // can never group differently than the form the VA priced.
  const ship = shippingAllocations(lots, shipCost);
  const allocations = new Map();
  let paidCents = 0;
  for (const lot of lots) {
    const perUnitCents = priceByKey.get(invoiceLines([lot])[0].key);
    const soldCents = perUnitCents * (Number(lot.quantity) || 0);
    paidCents += soldCents;
    allocations.set(lot.id, {
      soldTotal: soldCents / 100,
      shipTotal: ship.get(lot.id) ?? 0,
    });
  }

  // Claim first: the CAS decides the winner, so a second settler's numbers
  // never reach the lots. It also marks the invoice complete before the lot
  // allocations are written, so if that loop fails the invoice is settled while
  // its lots are stranded 'shipped' with no P/L - and canSettleInvoice then
  // refuses a retry. So a lot failure rolls the whole thing back to 'shipped',
  // clean to try again. Shipping is stored here too: the header must carry the
  // same figure the per-lot shares were spread from, or invoicePL
  // (paid − shipping − COG) and the sum of lot P/L would disagree by the delta.
  const settled = await settleInvoice(id, {
    paid: paidCents / 100,
    paidMethod: String(paidMethod || "").trim() || null,
    paidAt: paidDate ? new Date(`${paidDate}T12:00:00`).toISOString() : undefined,
    shipping: round2(shipCost),
  });
  if (!settled) return fail("Someone else settled or voided this invoice first.");

  try {
    await settleLots(allocations);
  } catch (err) {
    // Revert both halves: the lots this loop managed to complete (unsettleLots),
    // then the invoice claim (unsettleInvoice). Lots first, so the invoice is
    // the last thing to move - a retry keys off its status. Rollback failure is
    // the rare-squared case and is logged loudly, because only then is the state
    // one a person has to unpick. (The settle-time shipping figure stays on the
    // header through the unwind — a retry rewrites it, and it is the truer cost
    // than the create-time guess either way.)
    await unsettleLots(id).catch((e) =>
      console.error(`Settle rollback (lots) failed for ${id}:`, e?.message || e),
    );
    await unsettleInvoice(id).catch((e) =>
      console.error(`Settle rollback (invoice) failed for ${id}:`, e?.message || e),
    );
    console.error(`Settle lot allocation failed for ${id}:`, err?.message || err);
    return fail("Couldn't finish settling - the invoice was left unsettled, please try again.");
  }

  revalidatePath("/employee/invoices");
  revalidatePath(`/employee/invoices/${id}`);
  revalidatePath("/employee/inventory");
  return { ok: true };
}

/**
 * Correct what a settled invoice was settled FOR.
 *
 * The counterpart to voidInvoiceAction's refusal ("correct it with the buyer,
 * don't void it") — which, until now, pointed at a correction that did not
 * exist, so a mistyped settle amount was permanent and quietly wrong in every
 * P/L total downstream. Orders have had this for payouts all along; money
 * documents deserve the same.
 *
 * The lots KEEP the per-line actuals they settled at; what spreads is the
 * DELTA between the old and corrected totals — evenly per unit, in cents,
 * remainder on the last lot — so each device's price moves by its share and
 * the lot totals still sum exactly to the corrected figure. (The settle is
 * per-line now, but the common correction is "the payment didn't match the
 * sheet by $X", which is a total-level fact; re-entering every line for that
 * would punish the 24 lines that were right.) A reason is required and
 * appended to the invoice note: an amount that changed with no explanation
 * is worse than the typo.
 */
export async function correctSettlementAction(id, { paid, paidMethod, reason }) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/invoices")) return fail("You can't correct invoices.");

  const amount = Number(paid);
  if (!Number.isFinite(amount) || amount < 0) return fail("Enter the corrected amount.");
  const why = String(reason || "").trim();
  if (!why) return fail("Give a reason - this rewrites what the buyer paid.");

  const invoice = await getInvoice(id);
  if (!invoice) return fail("Invoice not found.");
  if (invoice.status !== "complete") {
    return fail("Only a settled invoice can be corrected.");
  }
  if (round2(amount) === round2(Number(invoice.paid) || 0)) {
    return fail("That's the amount it already has.");
  }

  // The delta is measured against the SUM OF THE LOTS, not invoice.paid, so
  // the re-allocated lot totals reconcile to the corrected figure exactly even
  // if header and lots had somehow drifted apart — this write heals that.
  const lots = stableLots(invoice.lots, "complete");
  const units = lots.reduce((sum, lot) => sum + (Number(lot.quantity) || 0), 0);
  if (!units) return fail("This invoice has no settled devices to re-allocate.");

  const deltaCents = toCents(round2(amount)) - lots.reduce((s, l) => s + toCents(l.soldTotal), 0);
  const perUnit = Math.trunc(deltaCents / units);
  const allocations = new Map();
  let spent = 0;
  for (let i = 0; i < lots.length; i += 1) {
    const lot = lots[i];
    const qty = Number(lot.quantity) || 0;
    const share = i === lots.length - 1 ? deltaCents - spent : perUnit * qty;
    spent += share;
    const soldCents = toCents(lot.soldTotal) + share;
    // A correction that drives a device below $0 means the story is per-line
    // (one device bounced, not "the total was off") — refuse rather than book
    // a negative sale price nobody typed.
    if (soldCents < 0) {
      return fail(
        "That correction would take a device below $0 — the fix belongs on a line, not the total.",
      );
    }
    allocations.set(lot.id, {
      soldTotal: soldCents / 100,
      shipTotal: Number(lot.shipTotal) || 0,
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const line = `Corrected ${stamp}: ${currency(invoice.paid)} -> ${currency(round2(amount))} - ${why} (${staff.name})`;
  const note = [invoice.note, line].filter(Boolean).join("\n");

  const corrected = await correctInvoiceSettlement(id, {
    paid: round2(amount),
    paidMethod: String(paidMethod || "").trim() || null,
    note,
  });
  if (!corrected) return fail("This invoice changed while you were looking at it. Reload.");

  // Same lots, same stable ordering — each keeps its settled price plus its
  // even share of the delta. Shipping shares don't move; shipping didn't.
  await reallocateLots(allocations);

  revalidatePath("/employee/invoices");
  revalidatePath(`/employee/invoices/${id}`);
  revalidatePath("/employee/inventory");
  revalidatePath("/employee/pl");
  return { ok: true };
}

/**
 * Void a shipped invoice: every lot returns to stock, the number stays
 * burned. Settled invoices refuse — money that moved is a correction
 * conversation, not a button.
 */
export async function voidInvoiceAction(id) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/invoices")) return fail("You can't void invoices.");

  const invoice = await getInvoice(id);
  if (!invoice) return fail("Invoice not found.");
  if (!canVoidInvoice(invoice)) {
    return fail(
      invoice.status === "complete"
        ? "This invoice is settled — correct it with the buyer, don't void it."
        : "This invoice is already voided.",
    );
  }

  // Claim first (one winner, and it loses cleanly to a concurrent settle), then
  // return the lots to stock. If that revert fails, the void is rolled back so
  // the boxes don't vanish - stranded 'shipped' on a voided invoice, which no
  // button could reach. revertLotsToStock is a single update, so the only
  // states are "all reverted" or "none", never half.
  const voided = await voidInvoice(id);
  if (!voided) return fail("Someone else settled or voided this invoice first.");

  try {
    await revertLotsToStock(
      (invoice.lots || []).filter((lot) => lot.status === "shipped").map((lot) => lot.id),
    );
  } catch (err) {
    await unvoidInvoice(id).catch((e) =>
      console.error(`Void rollback failed for ${id}:`, e?.message || e),
    );
    console.error(`Void lot revert failed for ${id}:`, err?.message || err);
    return fail(
      "Couldn't return the devices to stock - the invoice was left as it was, try again.",
    );
  }

  revalidatePath("/employee/invoices");
  revalidatePath(`/employee/invoices/${id}`);
  revalidatePath("/employee/inventory");
  return { ok: true };
}

/** Fix a buyer's paperwork — address and ACH terms feed the printed invoice. */
export async function updateBuyerAction(id, patch) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/invoices")) return fail("You can't edit buyers.");

  if ("name" in patch && !String(patch.name || "").trim()) {
    return fail("The buyer needs a name.");
  }
  await updateBuyer(id, patch);

  revalidatePath("/employee/invoices");
  return { ok: true };
}
