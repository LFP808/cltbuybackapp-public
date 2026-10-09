/**
 * The roles a person can hold. Stored in profiles.role.
 *
 * Two people run this business: Jaime (admin) and a remote VA who works the
 * inbox, the calls, the orders, inventory naming and invoicing. There is no
 * driver — nothing here travels — and no in-store staff role yet. Add a role
 * by adding it here AND to ROUTE_ACCESS in access.js; a role that exists in
 * only one place either sees nothing or is denied everything.
 */

/** The current role values, in descending order of authority. */
export const ROLES = ["admin", "va"];

/**
 * The role a login holds when nobody has granted it one.
 *
 * It is deliberately NOT in ROLES, so it never appears in a picker, never
 * counts as a team member, and — because ROUTE_ACCESS is fail-closed — opens
 * no page in the app. `homeFor()` lands it on /login, which is ungated, so it
 * dead-ends rather than looping.
 *
 * TWO THINGS MUST AGREE ON THIS VALUE: the `profiles.role` column default in
 * the schema and the fallbacks in lib/auth.js and lib/supabase/middleware.js.
 * A new account arrives holding nothing and an admin grants the role
 * explicitly on /team — anything else means a self-signup walks in holding
 * the inbox and the ability to text from the business number.
 */
export const NO_ACCESS_ROLE = "pending";

/**
 * Every value that might be in the column right now — what a DB query
 * filtering on role has to ask for. A fresh database has no legacy values,
 * so this is simply ROLES; it exists as its own export so a future rename
 * has one place to add the old value.
 */
export const DB_ROLE_VALUES = [...ROLES];

/**
 * Fold a stored role into the vocabulary the app reasons in. The fresh
 * schema has no legacy values to fold, but this stays the single entry
 * point (lib/auth.js and the middleware) so a future rename never makes
 * every permission check remember it.
 */
export function normalizeRole(role) {
  return role;
}

const ROLE_LABELS = {
  admin: "Admin",
  va: "VA",
  // Named explicitly because roleLabel() falls back to "VA": an account
  // holding no role at all must never be described as one that does.
  [NO_ACCESS_ROLE]: "No access",
};

/** Human label for a role value. */
export function roleLabel(role) {
  return ROLE_LABELS[role] || "VA";
}

export function isAdmin(role) {
  return role === "admin";
}
