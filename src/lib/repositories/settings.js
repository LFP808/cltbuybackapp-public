import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeBookingSchedule } from "@/domain/booking";
import { normalizeIncomingCalls } from "@/domain/phone-menu";
import { DEFAULT_GRADES } from "@/domain/inventory";
import { PAYMENT_METHODS } from "@/domain/constants";

/**
 * The app_settings key-value store: the knobs an admin turns from /settings
 * instead of from the hosting dashboard (booking hours, grades, payment
 * methods, the meetup address).
 *
 * READS DEGRADE, ALWAYS. Migrations are applied by hand here, so the code can
 * be live before the table exists — a failed read (missing table included)
 * returns null and the caller uses its built-in default. That is why every
 * setting MUST have one.
 *
 * WRITES GO THROUGH THE SERVICE ROLE on purpose: the table has a read policy
 * for staff and no write policy at all, so a signed-in non-admin talking to
 * PostgREST directly cannot change settings. The role check lives in the
 * server action (admin only); this layer just does what it is told.
 */

// The table not existing yet is the documented pre-migration state, not an
// incident — but logging it per request would page-fault every render into
// the dev overlay and flood production logs until the schema migration runs.
// Once per process is exactly as loud as an expected state deserves.
let warnedMissingTable = false;

/**
 * The stored value for a key, or null when unset/unreadable.
 *
 * `system: true` reads with the service role instead of the request's
 * session. For the sweeps, which run from a scheduler with no session: a
 * session client there is anonymous, RLS shows it zero rows, and the read
 * would "degrade" to the built-in default — so the reminders would text the
 * env fallback address while /settings shows the real one, with nothing
 * logged. Same reasoning as the admin client in repositories/reminders.js.
 */
export async function getSetting(key, { system = false } = {}) {
  try {
    const supabase = system ? createAdminClient() : await createClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  } catch (err) {
    const msg = String(err?.message || err);
    if (err?.code === "PGRST205" || /app_settings.*schema cache/.test(msg)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("app_settings doesn't exist yet - using defaults. Run the schema migration.");
      }
      return null;
    }
    console.error(`Setting read failed (${key}):`, msg);
    return null;
  }
}

/**
 * Write a setting. THROWS on failure — the save action turns that into a
 * returned error with instructions, and a silent no-op save would leave an
 * admin believing hours they never got.
 */
export async function setSetting(key, value, updatedBy) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: updatedBy || null });
  if (error) throw error;
}

export const BOOKING_HOURS_KEY = "booking_hours";

/**
 * The admin-set booking schedule (per-weekday windows + date overrides) as
 * normalized minutes — the one read every booking surface uses. Missing or
 * broken pieces fall back per normalizeBookingSchedule in domain/booking.js,
 * so the form, the picker and this read cannot disagree; the pre-schedule
 * flat {start,end} value still works.
 *
 * @param {{system?: boolean}} [opts] `system: true` for a caller with no
 *   session - the phone menu's webhook reads the hours aloud (see getSetting).
 */
export async function getBookingSchedule(opts) {
  return normalizeBookingSchedule(await getSetting(BOOKING_HOURS_KEY, opts));
}

export const GRADES_KEY = "grades";
export const PAYMENT_METHODS_KEY = "payment_methods";
// The meetup address: {street, street2, city, state, zip}. Read through
// lib/business.js, which merges it with the OFFICE_* env fallback — nothing
// else should read this key, or the fallback rule forks.
export const OFFICE_ADDRESS_KEY = "office_address";

// `true` silences the alert chime for ADMINS. Read by the staff layout (and
// only for an admin), which hands it to the shell's alert listeners.
export const ADMIN_SOUND_MUTED_KEY = "admin_sound_muted";

/**
 * Whether the alert chime (new text, new lead) is muted for admins. Strictly
 * `true` or it is off: a missing row, a failed read or a hand-edited "yes"
 * all degrade to SOUND ON, because a chime nobody wanted is an annoyance and
 * a silence nobody chose is a missed customer.
 */
export async function getAdminSoundMuted() {
  return (await getSetting(ADMIN_SOUND_MUTED_KEY)) === true;
}

// How an incoming call is handled, plus the sentence "message" mode speaks:
// {mode: "message" | "menu" | "ring", message: string}. Read by the "A call
// comes in" webhook, with `system: true`.
export const INCOMING_CALLS_KEY = "incoming_calls";

/**
 * What to do with an incoming call, normalized (domain/phone-menu.js): a
 * missing row, a failed read or a mangled value all come back as the default
 * - don't ring, play the standard message. That is the designed behaviour,
 * and every mode still gets the caller a text, so a degraded read never
 * strands anyone.
 *
 * @param {{system?: boolean}} [opts] `system: true` from the webhook.
 * @returns {Promise<{mode: "message"|"menu"|"ring", message: string}>}
 */
export async function getIncomingCalls(opts) {
  return normalizeIncomingCalls(await getSetting(INCOMING_CALLS_KEY, opts));
}

/**
 * A stored name list, cleaned: strings only, trimmed, blanks out, duplicates
 * out (case-insensitive, first spelling wins). An empty or unreadable value
 * falls back whole — a settings row someone blanked must not leave the
 * check-in form with zero grades to offer.
 */
function normalizeNameList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set();
  const names = value
    .map((v) => String(v ?? "").trim())
    .filter((name) => {
      if (!name || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      return true;
    });
  return names.length ? names : fallback;
}

/**
 * The admin-set grade ladder for devices, e.g. ["Sealed","A","B","C","Broken"]
 * — what check-in, lot editing and the grid filters offer. Same degrade rule
 * as every setting: missing or broken falls back to DEFAULT_GRADES, so grading
 * never goes dark because a settings row is absent.
 */
export async function getGrades() {
  return normalizeNameList(await getSetting(GRADES_KEY), DEFAULT_GRADES);
}

/**
 * The admin-set payment methods — what the payout and invoice-settle pickers
 * offer. Falls back to the domain's PAYMENT_METHODS list.
 */
export async function getPaymentMethods() {
  return normalizeNameList(await getSetting(PAYMENT_METHODS_KEY), PAYMENT_METHODS);
}
