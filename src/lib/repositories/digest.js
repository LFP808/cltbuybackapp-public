import { createAdminClient } from "@/lib/supabase/admin";
import { rowToOrder, rowToInvoice, rowToLot, rowToCall } from "@/lib/mappers";

/**
 * The reads behind the morning digest.
 *
 * Separate from the ordinary repositories because those are session-scoped:
 * scopeOrders resolves the CURRENT staff member to decide what they may see,
 * and a scheduled job has no current staff member. Called with no session, that
 * path correctly matches nothing — a digest that silently reported an empty,
 * blissful morning every single day.
 *
 * So these use the admin client and read unscoped, which is safe for exactly
 * one reason: the digest only ever goes to admins, whose scope is everything
 * anyway. If it is ever sent to a narrower role, this file is wrong and the
 * data has to be filtered per recipient instead.
 */

const DAY = 86400000;

/** Everything the attention rules need, in one round of queries. */
export async function readDigestInputs({ sinceDays = 120 } = {}) {
  const supabase = createAdminClient();
  // The rules all look at recent or open work, so a window keeps this from
  // growing into a full table scan as the business ages. Generous on purpose:
  // an invoice unsettled for three months is exactly what the digest exists to
  // shout about, so the window has to outlast the thing it is looking for.
  const since = new Date(Date.now() - sinceDays * DAY).toISOString();

  const [orders, invoices, lots, calls] = await Promise.all([
    supabase.from("orders").select("*").gte("created_at", since),
    supabase.from("invoices").select("*, buyers(*)").gte("created_at", since),
    supabase.from("inventory_lots").select("*").eq("status", "in_stock"),
    supabase.from("calls").select("*").gte("started_at", since),
  ]);

  // A FAILED READ IS NOT AN EMPTY MORNING. These errors used to be swallowed
  // into empty arrays, and because the digest's whole design is "silence means
  // nothing is wrong", a broken read produced the most reassuring output it
  // has — no text at all. The caller gets the failures by name and says so in
  // the message instead.
  const failedReads = [];
  if (orders.error) failedReads.push("orders");
  if (invoices.error) failedReads.push("invoices");
  if (lots.error) failedReads.push("stock");
  if (calls.error) failedReads.push("calls");
  for (const name of failedReads) console.error(`Digest could not read ${name}`);

  return {
    orders: (orders.data ?? []).map(rowToOrder),
    invoices: (invoices.data ?? []).map(rowToInvoice),
    lots: (lots.data ?? []).map(rowToLot),
    calls: (calls.data ?? []).map(rowToCall),
    failedReads,
  };
}

/**
 * Who gets the morning text: active admins with a number on file.
 *
 * Admin-only for the same reason /pl is — the digest names unpaid invoices and
 * aging stock, which is not everybody's business. Deactivated accounts are
 * excluded here rather than filtered later, so someone who has left the company
 * stops being texted the moment they are switched off.
 */
export async function digestRecipients() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, active")
    .eq("role", "admin");
  if (error) throw error;

  return (data ?? [])
    .filter((p) => p.active !== false && String(p.phone || "").trim())
    .map((p) => ({ id: p.id, name: p.full_name?.trim() || "admin", phone: p.phone }));
}
