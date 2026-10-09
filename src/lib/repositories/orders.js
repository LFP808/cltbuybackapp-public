import { createClient } from "@/lib/supabase/server";
import { rowToOrder, orderToRow, orderPatchToRow } from "@/lib/mappers";
import { scopeOrders, scopeOrder, assertCanActOn } from "@/lib/repositories/scope";
import { fetchAllRows } from "@/lib/repositories/all-rows";
import { normPhone } from "@/domain/format";
import { dayKey } from "@/domain/dates";

/**
 * Data access for orders, from authenticated (staff) contexts. Every call
 * goes through the request-scoped Supabase client, so row-level security is
 * enforced. Returns clean domain objects, never raw rows.
 */

/** List orders, newest first — narrowed to the caller's role scope. */
/**
 * A hard ceiling on how many orders one page will load.
 *
 * The dashboard filters in the browser, so an unbounded read meant shipping the
 * entire table to a laptop on every visit — invisible at a few dozen orders and
 * a slow page at a few thousand. Capped at the newest, with the caller told
 * when the cap bit so it can say so rather than quietly showing a partial list.
 *
 * The real fix is filtering server-side from the date range the list already
 * has; this is the honest stopgap until that is worth building.
 */
export const ORDER_PAGE_LIMIT = 500;

export async function listOrders() {
  const supabase = await createClient();
  const { data, error } = await scopeOrders(
    supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      // One extra row, purely to detect that there were more.
      .limit(ORDER_PAGE_LIMIT + 1),
  );
  if (error) throw error;
  const rows = data ?? [];
  const orders = rows.slice(0, ORDER_PAGE_LIMIT).map(rowToOrder);
  orders.truncated = rows.length > ORDER_PAGE_LIMIT;
  return orders;
}

/**
 * EVERY order, paged until the table runs out — the money page's read.
 *
 * The dashboard's cap above is a browser-perf decision; borrowed by the money
 * page it became a correctness bug, because a P/L computed over "the newest
 * 500" is simply a wrong number once order 501 exists, with nothing on screen
 * saying so. Admin-only and opened a few times a day, so the full read is
 * cheap where it is used. Ascending order per fetchAllRows' contract.
 */
export async function listOrdersComplete() {
  const supabase = await createClient();
  const { rows, truncated } = await fetchAllRows((from, to) =>
    scopeOrders(
      supabase.from("orders").select("*").order("created_at", { ascending: true }).range(from, to),
    ),
  );
  const orders = rows.map(rowToOrder);
  orders.truncated = truncated;
  return orders;
}

/** List a single customer's orders, newest first. */
export async function listOrdersByPhone(phone) {
  const supabase = await createClient();
  const { data, error } = await scopeOrders(
    supabase
      .from("orders")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: false }),
  );
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * Fetch a single order by id, or null if not found.
 *
 * Out-of-scope orders come back null rather than throwing, so a restricted
 * role probing ids can't tell a real order from one that doesn't exist.
 */
export async function getOrder(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return scopeOrder(data ? rowToOrder(data) : null);
}

/**
 * Everything with a date on it, for the calendar.
 *
 * Cancelled orders are excluded here rather than in the component, so the row
 * never reaches the browser at all. Paid orders stay in — the calendar is
 * also the record of past meetups, not just the plan of work still to do.
 */
export async function listCalendarOrders() {
  const supabase = await createClient();
  const { data, error } = await scopeOrders(
    supabase
      .from("orders")
      .select("*")
      .neq("status", "cancelled")
      // A meetup is dated by its appointment. Anything undated (a walk-in
      // logged after the fact never has one) has no place on a calendar yet.
      .not("pickup_date", "is", null)
      .order("pickup_date", { ascending: true, nullsFirst: false }),
  );
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * The appointment book: every meetup still to happen, slimmed to the fields
 * the slot picker and the double-book check read. Slim ON PURPOSE — this
 * rides into a client component's props on the intake form, and the
 * customer's phone and items have no business in that payload.
 *
 * `onDay` narrows to one date (the server-side conflict check); without it,
 * today onward (the picker, which lets the person browse dates freely).
 */
export async function listAppointments({ onDay = null } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*")
    .eq("type", "office")
    .not("status", "in", "(paid,cancelled)");
  query = onDay ? query.eq("pickup_date", onDay) : query.gte("pickup_date", dayKey(new Date()));
  const { data, error } = await scopeOrders(query);
  if (error) throw error;
  // Slimmed AFTER the one mapping boundary, not by a second hand-rolled one.
  return (data ?? []).map(rowToOrder).map((o) => ({
    id: o.id,
    type: o.type,
    status: o.status,
    name: o.name,
    pickupDate: o.pickupDate,
    pickupTime: o.pickupTime,
  }));
}

/** Every open meetup, scheduled or not, for the calendar's day tabs. */
export async function listPickups() {
  const supabase = await createClient();
  const { data, error } = await scopeOrders(
    supabase
      .from("orders")
      .select("*")
      .eq("type", "office")
      // Open only, matching isOpen() in domain/orders — this feeds the cash
      // float ("today's run" still needing money), unlike listCalendarOrders
      // above, which also keeps paid meetups for the calendar's own display.
      .not("status", "in", "(paid,cancelled)")
      .order("pickup_date", { ascending: true, nullsFirst: false }),
  );
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * Insert a new order; returns the created domain object.
 *
 * Scoped too: a restricted role must not create rows it then cannot read.
 */
export async function createOrder(shipment) {
  await assertCanActOn(shipment);
  const supabase = await createClient();
  // Through writeOrderRow like every other write, so an unapplied migration
  // degrades the row instead of refusing it. The insert names paid_at,
  // received_at and walk_in — all optional columns — and creation is the last
  // place that should fail because a bookkeeping column hasn't been added yet.
  const { data, error } = await writeOrderRow(orderToRow(shipment), (row) =>
    supabase.from("orders").insert(row).select("*").single(),
  );
  if (error) throw error;
  return rowToOrder(data);
}

/**
 * How many unfinished orders this number already has.
 *
 * Asked at intake so a second order for a customer we are already expecting
 * is a decision rather than an accident.
 *
 * Cancelled counts as finished: an order somebody deliberately ended should not
 * block the replacement they are creating right now.
 */
export async function countOpenOrdersForPhone(phone) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("phone", normPhone(phone))
    .not("status", "in", "(paid,cancelled)");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Move an order to a new status, but only from the one it is expected to be in.
 *
 * TWO PEOPLE, ONE ORDER. The admin and the VA can both have the same meetup
 * open; both press "Mark bought"; both writes succeed and the customer
 * gets told twice. The guard is the `.eq("status", from)` filter, so the second
 * writer loses in the database rather than in application code — which is the
 * only place it can be settled when the two requests are handled by different
 * server instances.
 *
 * Returns null when somebody got there first. The caller decides what to say;
 * this is not an error, it is a race that someone won.
 *
 * @param {string} id
 * @param {string} from the status the caller believes the order is in
 * @param {object} patch fields to write alongside the transition
 * @returns {Promise<object|null>}
 */
export async function advanceOrderStatus(id, from, patch) {
  const supabase = await createClient();
  const { data, error } = await writeOrderRow(orderPatchToRow(patch), (row) =>
    supabase.from("orders").update(row).eq("id", id).eq("status", from).select("*"),
  );
  if (error) throw error;
  return data?.length ? rowToOrder(data[0]) : null;
}

/**
 * Columns the app can live without, because migrations are applied BY HAND in
 * this project and a lagging one must degrade the row, not refuse it.
 *
 * They record when a payout left, when the devices arrived, and whether a
 * meetup was actually an unannounced walk-in — bookkeeping, not gating.
 * domain/cash.js already falls back to the activity log for the dates, so the
 * only thing an unapplied migration should cost is precision. It must never
 * cost someone the ability to mark an order paid, or — since createOrder goes
 * through the same retry — the ability to take an order at all.
 */
const OPTIONAL_COLUMNS = ["paid_at", "received_at", "walk_in"];

/**
 * The two ways "that column isn't there" comes back.
 *
 * 42703 is Postgres's own undefined_column. PGRST204 is PostgREST refusing to
 * BUILD the statement because the column is not in its schema cache — and that
 * is the one a missing column on an update actually produces. Matching only
 * 42703 meant the retry below never fired: marking an order paid died with
 * "Could not find the 'paid_at' column", on the exact screen where money
 * changes hands, which is precisely the failure this helper exists to prevent.
 * Caught by scripts/qa-flows.mjs rather than by reading the code.
 */
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

/**
 * Whether a write failed because a column the code knows about isn't in the
 * database yet — the "migration not run" case. Exported for the one write
 * that must NOT degrade: deleting an order writes deleted_at, and a delete
 * recorded without its stamp would be an ordinary cancel, which is a lie the
 * action would rather explain than tell.
 */
export function isMissingColumnError(err) {
  return MISSING_COLUMN.has(err?.code);
}

/**
 * Run a write, and if the database says one of the optional columns isn't
 * there, drop all of them and run it again.
 *
 * Retrying without the extras turns "marking an order paid explodes because
 * nobody ran 0022 yet" into "the order is paid and the timestamp isn't
 * recorded" — a degradation nobody has to debug at the counter.
 *
 * Deliberately ONE retry over a fixed list rather than parsing column names out
 * of the error: a loop that keeps stripping whatever the database complains
 * about would happily strip its way to an empty update and report success.
 */
async function writeOrderRow(row, run) {
  const first = await run(row);
  if (!MISSING_COLUMN.has(first.error?.code)) return first;

  const stripped = { ...row };
  let removed = false;
  for (const column of OPTIONAL_COLUMNS) {
    if (column in stripped) {
      delete stripped[column];
      removed = true;
    }
  }
  // The missing column was something else entirely — a real bug, and the
  // original error is the honest thing to hand back.
  if (!removed) return first;
  return run(stripped);
}

/**
 * Stamp an order as checked in — but only if nobody else has.
 *
 * The guard is `.is("checked_in_at", null)`: two people confirming the same
 * check-in would otherwise both insert lots and double the inventory. Claim
 * BEFORE inserting lots, so the race has one winner and the loser inserts
 * nothing; a failure after a successful claim leaves a checked-in order with
 * no lots, which is visible and re-enterable, unlike silent duplicates.
 *
 * @returns {Promise<object|null>} the updated order, or null if already claimed
 */
export async function claimCheckIn(id, activity) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ checked_in_at: new Date().toISOString(), activity })
    .eq("id", id)
    .is("checked_in_at", null)
    .select("*");
  if (error) throw error;
  return data?.length ? rowToOrder(data[0]) : null;
}

/**
 * Undo a check-in claim whose lot creation then failed.
 *
 * claimCheckIn stamps the order and takes it off the Pending queue BEFORE the
 * lots are inserted, so the claim can win and the insert still fail. Without
 * this the order was stuck checked-in with no inventory and no way back in the
 * app - repair meant hand-edited SQL. This puts checked_in_at back to null and
 * restores the activity to what it was before the claim, so the order returns
 * to Pending Check-in and can simply be tried again.
 *
 * Guarded so it only reverts a claim that is still in place: if the box was
 * somehow re-checked-in between the failure and this call, we leave that alone.
 *
 * @param {string} id
 * @param {object[]} priorActivity the order's activity BEFORE the claim
 */
export async function releaseCheckIn(id, priorActivity) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ checked_in_at: null, activity: priorActivity ?? [] })
    .eq("id", id)
    .not("checked_in_at", "is", null);
  if (error) throw error;
}

/**
 * Strike an order from the books — but only if nobody has already.
 *
 * Writes the deletion stamp AND flips status to cancelled in one statement,
 * guarded on `deleted_at IS NULL`: two admins deleting the same order would
 * otherwise both append a "Deleted" line and the second would re-list lots
 * that are already gone. Returns null when somebody got there first.
 *
 * Not through writeOrderRow on purpose: that helper strips optional columns
 * and retries, and deleted_at is not optional here — see isMissingColumnError.
 *
 * @param {string} id
 * @param {{deletedBy: string, deleteReason: string, activity: object[]}} patch
 */
export async function markOrderDeleted(id, { deletedBy, deleteReason, activity }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy ?? null,
      delete_reason: deleteReason ?? null,
      activity: activity ?? [],
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*");
  if (error) throw error;
  return data?.length ? rowToOrder(data[0]) : null;
}

/**
 * Patch an order by id with a partial domain object.
 *
 * Reads through getOrder first, so an out-of-scope order is invisible here
 * exactly as it is everywhere else — the write can't reach a row the caller
 * isn't allowed to see.
 */
export async function updateOrder(id, patch) {
  const existing = await getOrder(id);
  if (!existing) throw new Error("Order not found.");

  const supabase = await createClient();
  const { data, error } = await writeOrderRow(orderPatchToRow(patch), (row) =>
    supabase.from("orders").update(row).eq("id", id).select("*").single(),
  );
  if (error) throw error;
  return rowToOrder(data);
}
