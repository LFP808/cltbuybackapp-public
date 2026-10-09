import { getCurrentStaff } from "@/lib/auth";
import { orderTypesFor, canSeeOrder } from "@/domain/access";

/**
 * Role-based data scoping for order queries.
 *
 * With DATA_SCOPE empty (admin and VA both see everything), every call here is
 * a passthrough — but the mechanism is KEPT, and every repository read still
 * routes through it, because the failure mode of per-call filtering is the one
 * call that forgets, and that call is invisible until it leaks. The next
 * restricted role is an entry in domain/access.js, not a sweep of the
 * repositories.
 *
 * The old owned-only branch (a role that saw only rows assigned to it) is gone
 * with its backing column; if a scoped role returns, reintroduce the SQL
 * filter here so out-of-scope rows never leave Postgres.
 *
 * The role is resolved here rather than threaded through every signature, so
 * call sites don't change and can't accidentally pass the wrong one.
 * getCurrentStaff() is request-cached, so this costs nothing after the first
 * call in a render.
 */

/**
 * Narrow a Supabase query on the orders table to what the current staff
 * member may see. Unrestricted roles — currently everyone — get the query
 * back untouched.
 *
 * @template T
 * @param {T} query a supabase-js query builder over `orders`
 * @returns {Promise<T>}
 */
export async function scopeOrders(query) {
  const { role } = await getCurrentStaff();
  const types = orderTypesFor(role);
  return types ? query.in("type", types) : query;
}

/**
 * Gate a single fetched order. Returns null when it's outside the caller's
 * scope, so a restricted role probing ids sees exactly what it would see for
 * an id that doesn't exist — no confirmation that it's real.
 *
 * @template T
 * @param {T | null} order a mapped domain order, or null
 * @returns {Promise<T | null>}
 */
export async function scopeOrder(order) {
  if (!order) return null;
  const { role, id } = await getCurrentStaff();
  return canSeeOrder(role, order, id) ? order : null;
}

/**
 * Throw if the current staff member may not act on this order. Used on the
 * write path, where silently returning null would look like success.
 */
export async function assertCanActOn(order) {
  const { role, id } = await getCurrentStaff();
  if (!canSeeOrder(role, order, id)) {
    throw new Error("You don't have access to this order.");
  }
}
