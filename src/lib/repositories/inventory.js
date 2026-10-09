import { createClient } from "@/lib/supabase/server";
import { rowToLot, lotToRow } from "@/lib/mappers";
import { fetchAllRows } from "@/lib/repositories/all-rows";

/**
 * Data access for inventory lots.
 *
 * No role scoping here, unlike orders: the routes that reach inventory are
 * gated to admin and VA in ROUTE_ACCESS (fail-closed), and both may see all
 * of it. What IS enforced here is the lifecycle:
 * every mutation of a lot is guarded on the status it must currently hold, so
 * a race (someone invoicing a lot while someone else edits it) is settled in
 * the database, not in application code — the same pattern as
 * advanceOrderStatus.
 */

/** The embeds the grid needs: source + paid-via from the order, buyer + number from the invoice. */
const LOT_SELECT =
  "*, orders(type, name, phone, payment_method), invoices(number, status, buyers(name))";

/**
 * Same ceiling rationale as ORDER_PAGE_LIMIT: the grid filters in the
 * browser, so the read is bounded and the caller told when the cap bit.
 */
export const LOT_PAGE_LIMIT = 1000;

/**
 * Lots checked in inside [from, to) — the grid's date range, applied
 * server-side so "this month" never ships the whole table.
 *
 * @param {{from?: string, to?: string}} [range] ISO timestamps
 */
export async function listLots(range = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("inventory_lots")
    .select(LOT_SELECT)
    .order("created_at", { ascending: false })
    .limit(LOT_PAGE_LIMIT + 1);
  if (range.from) query = query.gte("created_at", range.from);
  if (range.to) query = query.lt("created_at", range.to);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const lots = rows.slice(0, LOT_PAGE_LIMIT).map(rowToLot);
  lots.truncated = rows.length > LOT_PAGE_LIMIT;
  return lots;
}

/**
 * EVERY lot, paged until the table runs out — the money page's read.
 *
 * Same reasoning as listOrdersComplete: the grid's cap is browser perf, but
 * P/L over "the newest 1000 lots" quietly loses COG and disposals the day lot
 * 1001 is checked in. Ascending per fetchAllRows' contract.
 */
export async function listLotsComplete() {
  const supabase = await createClient();
  const { rows, truncated } = await fetchAllRows((from, to) =>
    supabase
      .from("inventory_lots")
      .select(LOT_SELECT)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const lots = rows.map(rowToLot);
  lots.truncated = truncated;
  return lots;
}

/**
 * Unsold stock — the invoice builder's pick list, in a FULLY DETERMINED order.
 *
 * `created_at` alone is not an order at all here: a check-in inserts all its
 * lots in ONE statement, so every device from one visit shares an identical
 * `now()` timestamp and Postgres was free to return the tie in any sequence it
 * liked. The builder's rows therefore reshuffled between page loads, and since
 * each row's rate is typed into whichever input is second on screen, a price
 * could land on a different group than the one the operator was looking at.
 * (Caught by inventory-demo failing its projected-total assertion on one run
 * in three.)
 *
 * Item first is the useful tie-break rather than an arbitrary one: it keeps
 * the builder's (item, grade, cog) groups contiguous, so identical devices sit
 * together in the picker. `id` closes the door on any remaining tie, so the
 * sequence is fully determined by the data.
 */
export async function listLotsInStock() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(LOT_SELECT)
    .eq("status", "in_stock")
    .order("item", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToLot);
}

/**
 * Specific lots by id, in the order the ids were given — the label print
 * page's read, where the batch is whatever rows the grid had ticked and the
 * sheet should come out in the order the person saw them. Ids the database
 * doesn't know are simply absent from the answer.
 */
export async function listLotsByIds(ids = []) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("inventory_lots").select(LOT_SELECT).in("id", wanted);
  if (error) throw error;
  const byId = new Map((data ?? []).map((row) => [row.id, rowToLot(row)]));
  return wanted.map((id) => byId.get(id)).filter(Boolean);
}

export async function listLotsByOrder(orderId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(LOT_SELECT)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToLot);
}

/**
 * Everything ever bought from one customer, newest first — the "devices from
 * this customer" section. The inner join makes the order's phone a filter
 * rather than a decoration.
 */
export async function listLotsByPhone(phone) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(
      "*, orders!inner(type, name, phone, payment_method), invoices(number, status, buyers(name))",
    )
    .eq("orders.phone", phone)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToLot);
}

export async function getLot(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .select(LOT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToLot(data) : null;
}

/** Bulk insert from a confirmed check-in; returns the created lots. */
export async function createLots(lots) {
  if (!lots.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .insert(lots.map(lotToRow))
    .select("*");
  if (error) throw error;
  return (data ?? []).map(rowToLot);
}

/**
 * Correct an in-stock lot's facts, appending to its audit log.
 *
 * Guarded on `status = in_stock`: once a lot is invoiced its facts are part
 * of a money document and lock. Returns null when the guard bites (someone
 * invoiced it between your read and your save) — a race outcome for the
 * caller to report, not a fault.
 */
export async function updateLotFacts(id, patch, editEntries) {
  const supabase = await createClient();
  const row = {};
  // The editable facts of a device: what it is, its identifiers, its grade,
  // and what we paid. `details` is the sickw-pulled jsonb blob and is replaced
  // whole — it is one lookup's answer, not a bag of independent fields.
  if ("item" in patch) row.item = patch.item;
  if ("imei" in patch) row.imei = patch.imei || null;
  if ("serial" in patch) row.serial = patch.serial || null;
  if ("carrier" in patch) row.carrier = patch.carrier || null;
  if ("grade" in patch) row.grade = patch.grade || null;
  if ("details" in patch) row.details = patch.details || {};
  if ("cog" in patch) row.cog = patch.cog;
  if ("quantity" in patch) row.quantity = patch.quantity;
  if (editEntries?.length) {
    const current = await getLot(id);
    if (!current) return null;
    row.edits = [...(current.edits ?? []), ...editEntries];
  }
  const { data, error } = await supabase
    .from("inventory_lots")
    .update(row)
    .eq("id", id)
    .eq("status", "in_stock")
    .select("*");
  if (error) throw error;
  return data?.length ? rowToLot(data[0]) : null;
}

/**
 * Remove every lot an order still owns outright — the inventory half of an
 * admin deleting the order. Guarded to in_stock and disposed: a lot that is
 * on an invoice or sold belongs to a money document and is NOT touched (the
 * action refuses the whole delete while any exist, and re-reads after this
 * to catch one that was invoiced in the gap). Returns what was removed so
 * the order's trail can say which devices they were.
 *
 * @returns {Promise<Array<{id: string, item: string, imei?: string, serial?: string}>>}
 */
export async function deleteLotsForOrder(orderId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .delete()
    .eq("order_id", orderId)
    .in("status", ["in_stock", "disposed"])
    .select("id, item, imei, serial");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    item: row.item,
    imei: row.imei ?? undefined,
    serial: row.serial ?? undefined,
  }));
}

/** Remove a mistaken lot entirely. Same in-stock guard; null when locked. */
export async function deleteLot(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .delete()
    .eq("id", id)
    .eq("status", "in_stock")
    .select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

/**
 * Sell a device on a direct channel (eBay) — in_stock straight to complete
 * with no invoice. The compare-and-swap on status is the whole concurrency
 * story: a lot someone else just invoiced or disposed comes back null.
 * The sale facts land beside the same columns an invoice settle writes
 * (sold_total, ship_total), plus the fee and channel that only exist here.
 */
export async function sellLotDirect(
  id,
  { soldTotal, feeTotal, shipTotal, soldChannel, soldAt },
  editEntry,
) {
  const supabase = await createClient();
  const current = await getLot(id);
  if (!current) return null;
  const { data, error } = await supabase
    .from("inventory_lots")
    .update({
      status: "complete",
      sold_total: soldTotal,
      fee_total: feeTotal ?? null,
      ship_total: shipTotal ?? null,
      sold_channel: soldChannel,
      sold_at: new Date(soldAt).toISOString(),
      edits: [...(current.edits ?? []), editEntry],
    })
    .eq("id", id)
    .eq("status", "in_stock")
    .select("*");
  if (error) throw error;
  return data?.length ? rowToLot(data[0]) : null;
}

/**
 * Reverse a direct sale — the undo an invoice sale gets via Void. Guarded on
 * "complete AND no invoice AND a channel recorded" so it can never unwind an
 * invoice settle, which reconciles at the document level, not per device.
 */
export async function undoDirectSale(id, editEntry) {
  const supabase = await createClient();
  const current = await getLot(id);
  if (!current) return null;
  const { data, error } = await supabase
    .from("inventory_lots")
    .update({
      status: "in_stock",
      sold_total: null,
      fee_total: null,
      ship_total: null,
      sold_channel: null,
      sold_at: null,
      edits: [...(current.edits ?? []), editEntry],
    })
    .eq("id", id)
    .eq("status", "complete")
    .is("invoice_id", null)
    .not("sold_channel", "is", null)
    .select("*");
  if (error) throw error;
  return data?.length ? rowToLot(data[0]) : null;
}

/** Write off unsold stock (dead, blacklisted, FMI-locked). Its P/L becomes -COG, derived. */
export async function disposeLot(id, note) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_lots")
    .update({
      status: "disposed",
      disposed_at: new Date().toISOString(),
      dispose_note: note || null,
    })
    .eq("id", id)
    .eq("status", "in_stock")
    .select("*");
  if (error) throw error;
  return data?.length ? rowToLot(data[0]) : null;
}

/**
 * Attach lots to a new invoice and mark them shipped, each at its per-unit
 * rate. Rates differ per lot, so this is one guarded update per lot rather
 * than a bulk write; the in-stock guard means a lot someone else just sold or
 * deleted is SKIPPED, and the caller compares what it got back against what
 * it asked for to detect the race and unwind.
 *
 * @param {Array<{id: string, rate: number}>} picks
 * @returns {Promise<string[]>} ids that actually moved to shipped
 */
export async function markLotsShipped(picks, invoiceId) {
  const supabase = await createClient();
  const shipped = [];
  for (const pick of picks) {
    const { data, error } = await supabase
      .from("inventory_lots")
      .update({ invoice_id: invoiceId, rate: pick.rate, status: "shipped" })
      .eq("id", pick.id)
      .eq("status", "in_stock")
      .select("id");
    if (error) throw error;
    if (data?.length) shipped.push(pick.id);
  }
  return shipped;
}

/**
 * Put shipped lots back on the shelf — the void path, and the unwind when
 * invoice creation loses a race halfway through. Money fields clear because
 * the lot is no longer part of any document.
 */
export async function revertLotsToStock(ids) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_lots")
    .update({
      invoice_id: null,
      rate: null,
      sold_total: null,
      ship_total: null,
      status: "in_stock",
    })
    .in("id", ids)
    .eq("status", "shipped");
  if (error) throw error;
}

/**
 * Write the settle allocations. Each lot takes its computed share; the guard
 * on `shipped` makes a double-settle harmless (the second pass matches no
 * rows because the first already moved them to complete).
 *
 * @param {Map<string, {soldTotal: number, shipTotal: number}>} allocations by lot id
 */
export async function settleLots(allocations) {
  const supabase = await createClient();
  for (const [id, share] of allocations) {
    const { error } = await supabase
      .from("inventory_lots")
      .update({ sold_total: share.soldTotal, ship_total: share.shipTotal, status: "complete" })
      .eq("id", id)
      .eq("status", "shipped");
    if (error) throw error;
  }
}

/**
 * Undo the lot side of a settle that failed partway.
 *
 * settleLots is a per-lot loop, so an error mid-way leaves some of an invoice's
 * lots 'complete' and the rest 'shipped'. This returns every complete lot on the
 * invoice to 'shipped' and clears its settled figures, so a retry recomputes the
 * even per-unit spread over the WHOLE invoice again rather than a leftover
 * subset. Scoped to one invoice and to complete lots, so it touches only the
 * boxes this settle changed - a shipped invoice's lots are all 'shipped' before
 * it runs, so any 'complete' one is this attempt's doing.
 */
export async function unsettleLots(invoiceId) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_lots")
    .update({ sold_total: null, ship_total: null, status: "shipped" })
    .eq("invoice_id", invoiceId)
    .eq("status", "complete");
  if (error) throw error;
}

/**
 * Rewrite the allocations on lots that are ALREADY complete.
 *
 * The correction counterpart to settleLots. Same shape, but it guards on
 * `complete` instead of `shipped` and never changes the status — the sale
 * still happened, only the money is being restated. Lot P/L is derived from
 * these two columns, so every downstream total follows automatically.
 */
export async function reallocateLots(allocations) {
  const supabase = await createClient();
  for (const [id, share] of allocations) {
    const { error } = await supabase
      .from("inventory_lots")
      .update({ sold_total: share.soldTotal, ship_total: share.shipTotal })
      .eq("id", id)
      .eq("status", "complete");
    if (error) throw error;
  }
}
