import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { normalizeRole, NO_ACCESS_ROLE } from "@/domain/roles";

/**
 * The current staff member's display name + role from their profile.
 *
 * A signed-OUT visitor gets `{ id: null, role: null }`. An ancestor of this
 * fell back to an ordinary-employee role, which quietly made "nobody" the
 * same thing as "an employee" and let an unauthenticated caller pass
 * permission checks. null fails every check in domain/access.js instead,
 * because ROUTE_ACCESS is fail-closed and no rule lists null.
 *
 * This does NOT throw for anonymous callers — read paths (the layout, pages,
 * scopeOrders) call it on every render and need a value. Write paths should use
 * requireStaff() below.
 *
 * Wrapped in React's `cache` so the many callers in one render — every scoped
 * repository read, plus the layout — share a single profile lookup. The cache
 * is per-request, so it can't leak one user's role into another's response.
 *
 * @returns {Promise<{ id: string|null, name: string, role: string|null }>}
 */
export const getCurrentStaff = cache(async function getCurrentStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, name: "Unknown", role: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    name: profile?.full_name?.trim() || user.email || "Unknown",
    // normalizeRole is identity today (no legacy values on a fresh database)
    // but stays in the path: this is one of the two places a role enters the
    // app, so a future rename has one seam. The fallback mirrors the column's
    // own default for a signed-in user whose profile row doesn't exist, and
    // it grants NOTHING on purpose: this branch is reached by an account the
    // app never created, which is the one case where guessing generously
    // hands out the inbox to whoever just signed themselves up.
    role: normalizeRole(profile?.role) || NO_ACCESS_ROLE,
  };
});

/**
 * The current staff member, or a thrown fault if nobody is signed in.
 *
 * The second lock on the write path. Server actions are gated by middleware,
 * but a Server Action POSTs to an ordinary page path, and a gap in that gate
 * once let "no session" reach an action body. Middleware refuses those paths;
 * this makes an action safe on its own regardless.
 *
 * Throws rather than returning `{ error }` on purpose: signing out mid-edit is
 * a genuine fault, not a user-facing outcome, and the generic production
 * message is the right thing to show for it. Expected failures still use
 * fail().
 */
export async function requireStaff() {
  const staff = await getCurrentStaff();
  if (!staff.id) throw new Error("Not signed in.");
  return staff;
}
