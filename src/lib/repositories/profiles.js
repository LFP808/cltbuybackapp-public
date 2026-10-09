import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
// DB_ROLE_VALUES, not ROLES, for QUERIES: today they are the same list, but
// the distinction survives so the next role rename can widen the query list
// without touching every read.
import { DB_ROLE_VALUES, normalizeRole } from "@/domain/roles";

/**
 * Staff directory reads.
 *
 * Profiles are readable by any authenticated employee (see the
 * profiles_read_all policy in 0001_init), so these use the session client —
 * no service-role escalation needed.
 */

/**
 * People whose browser should ring when a customer calls.
 *
 * By ROLE, not by presence. A <Client> leg to someone whose browser isn't
 * registered fails instantly and is simply not one of the phones that rang, so
 * there is no availability state to keep in sync - and state that has to be
 * cleaned up on every crashed tab and closed laptop is exactly the kind that
 * drifts and then silently stops ringing the right people.
 *
 * Uses the admin client because the caller is Twilio, which has no session -
 * the route validates Twilio's signature instead.
 *
 * @returns {Promise<{id: string, name: string}[]>}
 */
export async function listVoiceStaff() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("profiles").select("*").in("role", DB_ROLE_VALUES);
  if (error) throw error;
  return (
    (data ?? [])
      // Filtered in JS rather than in the query, and `select *` rather than a
      // column list, so this keeps working on a database missing the column —
      // undefined is not false, so everyone rings until it exists. Migrations
      // here are run by hand; code that hard-requires a column silences the
      // phones until they are.
      .filter((p) => p.active !== false)
      .map((p) => ({ id: p.id, name: p.full_name?.trim() || "Staff" }))
  );
}

/**
 * Everyone who should get an immediate staff alert text (a new appointment,
 * same idea as digestRecipients for the morning digest) - any active role
 * with a phone on file. Unlike digestRecipients this is NOT admin-only: both
 * roles work the calendar, so both should know when it changes.
 */
export async function activeStaffRecipients() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, phone, active");
  if (error) throw error;
  return (data ?? [])
    .filter((p) => p.active !== false && String(p.phone || "").trim())
    .map((p) => ({ id: p.id, name: p.full_name?.trim() || "Staff", phone: p.phone }));
}

/** Everyone on the team, for the admin management screen. */
export async function listTeamMembers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || "(unnamed)",
    role: normalizeRole(p.role) || "va",
    phone: p.phone || "",
    // Null for rows created before the column existed — those are active.
    active: p.active !== false,
    deactivatedAt: p.deactivated_at ? new Date(p.deactivated_at).getTime() : null,
    createdAt: p.created_at ? new Date(p.created_at).getTime() : null,
  }));
}

/**
 * Create a staff login.
 *
 * Uses the service role because only an admin API can mint an auth user. The
 * profile row (and therefore the id the activity trail points at) is created
 * by the on_auth_user_created trigger, so the id is unique and automatic —
 * there is nothing for an admin to type or keep in sync.
 *
 * The account is created pre-confirmed with a generated password: this is a
 * back-office tool where the admin hands credentials to the VA directly, and
 * an emailed invite depends on SMTP that isn't configured. The password is
 * returned once, for that handover, and never stored anywhere readable.
 *
 * @returns {Promise<{id: string, name: string, role: string, password: string}>}
 */
export async function createTeamMember({ email, name, role }) {
  const supabase = createAdminClient();
  // Held here, not read back from the response — Supabase never returns a
  // password, so this is the only moment it exists in readable form.
  const password = generatePassword();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(error.message || "Could not create that login.");

  const id = data?.user?.id;
  if (!id) throw new Error("The login was created but no profile id came back.");

  // The trigger writes full_name from user_metadata; role is ours to set.
  const { error: roleError } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (roleError) throw roleError;

  return { id, name, role, password };
}

/** Change someone's role. */
export async function setTeamMemberRole(id, role) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) throw error;
}

/** This person's contact number on the roster. Blank clears it. */
export async function setTeamMemberPhone(id, phone) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ phone: phone || null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Switch a login off, or back on.
 *
 * TWO WRITES, and the auth one is the one that matters: banning the auth user
 * is what actually refuses the password at the door, immediately and for any
 * session they still hold. The profiles flag is so the roster can say who is
 * switched off — and so the voice ring group can stop including them —
 * without calling the admin API for every row.
 *
 * Deactivating rather than deleting, because their name is on historical
 * orders, payouts, and activity trails. Deleting the login would either orphan
 * that history or rewrite it; neither is honest.
 */
export async function setTeamMemberActive(id, active) {
  const supabase = createAdminClient();

  const { error: authError } = await supabase.auth.admin.updateUserById(id, {
    // Supabase takes a duration string; "none" lifts an existing ban. A
    // hundred years is the idiom for "until somebody turns it back on".
    ban_duration: active ? "none" : "876000h",
  });
  if (authError) throw new Error(authError.message || "Could not change that login.");

  const { error } = await supabase
    .from("profiles")
    .update({ active, deactivated_at: active ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Issue a new password for someone who lost theirs.
 *
 * Same handover as creation: generated here, shown once, never stored
 * readably. The UI has always promised a password "can only be reset" — this
 * is the action that makes that true without a trip to the Supabase console.
 */
export async function resetTeamMemberPassword(id) {
  const supabase = createAdminClient();
  const password = generatePassword();
  const { error } = await supabase.auth.admin.updateUserById(id, { password });
  if (error) throw new Error(error.message || "Could not reset that password.");
  return password;
}

/**
 * A password that satisfies Supabase's rules and is still readable aloud over
 * the phone — no look-alike characters, since this gets dictated to a person.
 */
function generatePassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
