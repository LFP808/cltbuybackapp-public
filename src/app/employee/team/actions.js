"use server";

import { revalidatePath } from "next/cache";
import {
  createTeamMember,
  setTeamMemberRole,
  setTeamMemberPhone,
  setTeamMemberActive,
  resetTeamMemberPassword,
} from "@/lib/repositories/profiles";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { ROLES } from "@/domain/roles";
import { normPhone } from "@/domain/format";

/**
 * Team management. Every action here can mint a login or change what someone
 * can see, so each re-checks the caller is an admin — the page is already
 * role-gated, but a gate you can only see is not a gate.
 */

/**
 * The signed-in admin, as `{ staff }` — or `{ error }` for anyone else.
 *
 * Returns the refusal rather than throwing it so the caller can hand it
 * straight back with `return fail(error)`; a thrown message would not survive a
 * production build. The two-shape return is what forces every caller to look.
 */
async function requireAdmin() {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { error: "Only an admin can manage the team." };
  }
  return { staff };
}

/**
 * Add a team member and return their one-time password.
 *
 * The returned password is shown once so it can be handed over, then it is
 * gone — there is no way to read it back, only to reset it.
 */
export async function addTeamMemberAction({ email, name, role }) {
  const { error } = await requireAdmin();
  if (error) return fail(error);

  const cleanEmail = String(email || "")
    .trim()
    .toLowerCase();
  const cleanName = String(name || "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return fail("Enter a valid email.");
  if (!cleanName) return fail("Enter a name — it appears on run sheets and activity logs.");
  if (!ROLES.includes(role)) return fail("Pick a valid role.");

  let created;
  try {
    created = await createTeamMember({ email: cleanEmail, name: cleanName, role });
  } catch (err) {
    // Overwhelmingly this is "already been registered" — the most common way
    // this form fails, entirely fixable by the admin, and exactly the message a
    // production build would otherwise replace with boilerplate.
    return fail(err?.message || "Could not create that login.");
  }

  revalidatePath("/employee/team");
  return created;
}

/** Change a team member's role. */
export async function setRoleAction(id, role) {
  const { staff, error } = await requireAdmin();
  if (error) return fail(error);

  if (!ROLES.includes(role)) return fail("Pick a valid role.");
  // Locking yourself out of the only admin account is not recoverable in-app.
  if (id === staff.id && role !== "admin") {
    return fail("You can't remove your own admin access.");
  }

  await setTeamMemberRole(id, role);
  revalidatePath("/employee/team");
}

/**
 * Set a team member's phone number. Stored for everyone — a column that only
 * some rows may use invites a rule nobody remembers.
 */
export async function setTeamPhoneAction(id, phone) {
  const { error } = await requireAdmin();
  if (error) return fail(error);

  const digits = normPhone(phone || "");
  if (phone && digits.length !== 10)
    return fail("Enter a 10-digit phone number, or leave it blank.");

  await setTeamMemberPhone(id, digits || null);
  revalidatePath("/employee/team");
}

/**
 * Switch a login off (or back on).
 *
 * The missing half of provisioning: /team could create a login but never stop
 * one, so a departed employee kept working credentials until somebody opened
 * the Supabase console. Deactivating bans the auth user outright — their
 * password stops working immediately — while keeping their name on the orders
 * and payouts they handled.
 */
export async function setTeamActiveAction(id, active) {
  const { staff, error } = await requireAdmin();
  if (error) return fail(error);
  // Same protection as the role guard: locking yourself out is unrecoverable
  // from inside the app.
  if (id === staff.id && !active) return fail("You can't deactivate your own login.");

  try {
    await setTeamMemberActive(id, Boolean(active));
  } catch (err) {
    return fail(err?.message || "Could not change that login.");
  }

  revalidatePath("/employee/team");
}

/**
 * Issue a fresh one-time password. Shown once, exactly like creation — the UI
 * has always said a password can only be reset, and now that is true in-app.
 */
export async function resetPasswordAction(id) {
  const { error } = await requireAdmin();
  if (error) return fail(error);

  try {
    const password = await resetTeamMemberPassword(id);
    return { password };
  } catch (err) {
    return fail(err?.message || "Could not reset that password.");
  }
}
