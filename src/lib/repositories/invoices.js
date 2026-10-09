import { createClient } from "@/lib/supabase/server";
import { rowToInvoice } from "@/lib/mappers";
import { fetchAllRows } from "@/lib/repositories/all-rows";

/**
 * Data access for invoices. The multi-table sequences (create-and-ship,
 * settle, void) are composed in the server actions from these guarded pieces;
 * every status transition here is a compare-and-swap on the current status,
 * so concurrent operators lose in the database rather than double-settling.
 */

export async function listInvoices() {
  const supabase = await createClient();
  // Paged: a plain unlimited select is quietly truncated by PostgREST's own
  // max-rows (1000 on a default project), and both consumers — the list page
  // and the money page — mean "all of them". Paged ascending (fetchAllRows'
  // contract), then flipped to keep the newest-first API.
  const { rows, truncated } = await fetchAllRows((from, to) =>
    supabase
      .from("invoices")
      // Enough of each lot to compute units and realized P/L for the list page
      // without a second query — bought_by included because the money page's
      // per-person rollup is part of that P/L.
      .select(
        "*, buyers(*), inventory_lots(id, quantity, status, cog, rate, sold_total, ship_total, fee_total, bought_by)",
      )
      .order("number", { ascending: true })
      .range(from, to),
  );
  const invoices = rows.reverse().map(rowToInvoice);
  invoices.truncated = truncated;
  return invoices;
}

export async function getInvoice(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, buyers(*), inventory_lots(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToInvoice(data) : null;
}

/**
 * Insert the invoice header. `projected` is frozen here (sum of rate × qty
 * the caller computed) so the list renders without joining lots and the
 * number survives a later void. The sequence assigns `number`.
 */
export async function createInvoice({ buyerId, projected, shipping, note, createdBy }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      buyer_id: buyerId,
      projected,
      shipping: shipping || 0,
      note: note || null,
      created_by: createdBy ?? null,
    })
    .select("*, buyers(*)")
    .single();
  if (error) throw error;
  return rowToInvoice(data);
}

/**
 * CAS shipped → complete with the payment facts. Returns null when someone
 * else settled (or voided) first — the caller reports the race, and the
 * loser's numbers never touch the lots.
 *
 * `shipping` (optional) restates the header at settle time: the create-time
 * figure was a guess, the settle form's is the actual cost the per-lot shares
 * were spread from, and invoicePL (paid − shipping − COG) must read the same
 * number as the sum of lot P/L or the two surfaces disagree by the delta.
 */
export async function settleInvoice(id, { paid, paidMethod, paidAt, shipping }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({
      status: "complete",
      paid,
      paid_method: paidMethod || null,
      paid_at: paidAt || new Date().toISOString(),
      ...(shipping != null ? { shipping } : {}),
    })
    .eq("id", id)
    .eq("status", "shipped")
    .select("*, buyers(*)");
  if (error) throw error;
  return data?.length ? rowToInvoice(data[0]) : null;
}

/**
 * Fix the amount on an invoice that is ALREADY settled.
 *
 * CAS on `complete` rather than `shipped`: the invoice stays settled — this
 * changes what it was settled FOR. The note carries the audit line, because
 * an amount that silently changed is worse than no correction at all.
 *
 * Returns null when the invoice moved (voided, or corrected concurrently).
 */
export async function correctInvoiceSettlement(id, { paid, paidMethod, note }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({
      paid,
      ...(paidMethod ? { paid_method: paidMethod } : {}),
      note,
    })
    .eq("id", id)
    .eq("status", "complete")
    .select("*, buyers(*)");
  if (error) throw error;
  return data?.length ? rowToInvoice(data[0]) : null;
}

/**
 * Undo a settle-claim whose lot allocations then failed.
 *
 * settleInvoice marks the invoice complete before the per-lot loop runs, and
 * that loop can throw partway. This puts the invoice back to 'shipped' and
 * clears the paid figures, so canSettleInvoice allows a clean retry - the lots
 * are un-settled separately (unsettleLots) because they live in another table.
 * Guarded on status='complete' so it only reverses a settle still in place.
 */
export async function unsettleInvoice(id) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "shipped", paid: null, paid_method: null, paid_at: null })
    .eq("id", id)
    .eq("status", "complete");
  if (error) throw error;
}

/** CAS shipped → voided. The number stays burned; lots are reverted by the caller. */
export async function voidInvoice(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "voided", voided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "shipped")
    .select("*, buyers(*)");
  if (error) throw error;
  return data?.length ? rowToInvoice(data[0]) : null;
}

/**
 * Undo a void whose lot revert then failed.
 *
 * voidInvoice flips the invoice before its lots are returned to stock, so the
 * invoice can read voided while its boxes are stranded 'shipped' and invisible
 * to every stock count - and canVoidInvoice then refuses a retry. Putting the
 * invoice back to 'shipped' reopens the whole operation to be tried again.
 * Guarded on status='voided' so it only reverses a void still in place.
 */
export async function unvoidInvoice(id) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "shipped", voided_at: null })
    .eq("id", id)
    .eq("status", "voided");
  if (error) throw error;
}

/** Remove an invoice header that never got its lots — the create-race unwind. */
export async function deleteEmptyInvoice(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
}
