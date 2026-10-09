"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canWrite } from "@/domain/access";
import {
  setSetting,
  getGrades,
  BOOKING_HOURS_KEY,
  GRADES_KEY,
  PAYMENT_METHODS_KEY,
  OFFICE_ADDRESS_KEY,
  ADMIN_SOUND_MUTED_KEY,
  INCOMING_CALLS_KEY,
} from "@/lib/repositories/settings";
import { slotOf, slotValue, WEEKDAY_KEYS } from "@/domain/booking";
import { addressLine, validateOfficeAddress } from "@/domain/office";
import { validateIncomingCalls } from "@/domain/phone-menu";

const DAY_NAMES = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * Save the booking schedule the slot grid offers (Jaime, 2026-08-13):
 * hours per weekday plus special-case dates (closed, or different hours).
 *
 * ADMIN ONLY, checked here and not only at the route: /settings is admin-only
 * in ROUTE_ACCESS, but a server action is a public POST endpoint, and the
 * app_settings table deliberately has no write policy — this action plus the
 * service role is the entire write path.
 *
 * Every time snaps DOWN to the same 15-minute grid the pickers use (slotOf),
 * and every refusal NAMES the day or date it is refusing — "a time is wrong
 * somewhere in these fourteen inputs" is not an error message.
 *
 * @param {{week: Record<string, {start: string, end: string}|null>,
 *          dates: Array<{date: string, closed: boolean, start?: string, end?: string}>}} input
 */
export async function saveBookingScheduleAction({ week, dates } = {}) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can change booking hours.");

  const canonicalWeek = {};
  for (const key of WEEKDAY_KEYS) {
    const value = week?.[key];
    if (value === null || value === undefined) {
      canonicalWeek[key] = null; // closed
      continue;
    }
    const window = readWindow(value, DAY_NAMES[key]);
    if (window.error) return window;
    canonicalWeek[key] = window;
  }
  if (WEEKDAY_KEYS.every((key) => canonicalWeek[key] === null)) {
    return fail("Every weekday is closed - open at least one, or bookings can never be tapped.");
  }

  const canonicalDates = {};
  for (const entry of Array.isArray(dates) ? dates : []) {
    const date = String(entry?.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return fail("Every special date needs an actual date picked.");
    }
    if (date in canonicalDates) {
      return fail(`${date} is listed twice - keep one.`);
    }
    if (entry.closed) {
      canonicalDates[date] = null;
      continue;
    }
    const window = readWindow(entry, date);
    if (window.error) return window;
    canonicalDates[date] = window;
  }

  try {
    await setSetting(BOOKING_HOURS_KEY, { week: canonicalWeek, dates: canonicalDates }, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  revalidatePath("/employee/settings");
  revalidatePath("/employee/new");
  return { saved: true };
}

/**
 * The admin-editable name lists on /settings, keyed by their app_settings key.
 * A whitelist rather than a passthrough: the action is a public POST endpoint,
 * and "save any key you name" would let a signed-in admin's browser bug
 * overwrite booking_hours with an array.
 *
 * `revalidate` is where each list is READ, so the pickers refresh without a
 * hard reload. (Order detail pages read payment methods too, but they're
 * dynamic per-id routes; they re-read app_settings on their next request.)
 */
const NAME_LISTS = {
  [GRADES_KEY]: {
    one: "grade",
    // /new too: the booking form's condition picker reads the same ladder.
    revalidate: ["/employee/settings", "/employee/inventory", "/employee/new"],
  },
  [PAYMENT_METHODS_KEY]: {
    one: "payment method",
    revalidate: ["/employee/settings", "/employee/new"],
  },
};

/**
 * Save one of the /settings name lists (grades, payment methods).
 *
 * ADMIN ONLY, same reasoning as the booking schedule above: app_settings has
 * no write policy, so this action plus the service role is the entire write
 * path. Values are free text ON PURPOSE — a grade is a word buyers read, not
 * an enum the database enforces — so removing one never touches rows that
 * already carry it; the cards say so in their helper text.
 *
 * @param {string} key    GRADES_KEY | PAYMENT_METHODS_KEY
 * @param {string[]} names  the full list, in display order
 */
export async function saveNameListAction(key, names) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can change this list.");

  const list = NAME_LISTS[key];
  if (!list) return fail("That isn't an editable list.");

  const clean = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw ?? "").trim();
    if (!name) return fail("A row is blank - fill it in or remove it.");
    if (name.length > 40) return fail(`"${name.slice(0, 40)}..." is too long - 40 characters max.`);
    // Case-insensitive: "cash" next to "Cash" is one method typed twice, and
    // two spellings in a picker means two buckets in every report.
    if (seen.has(name.toLowerCase())) return fail(`"${name}" is listed twice - keep one.`);
    seen.add(name.toLowerCase());
    clean.push(name);
  }
  if (!clean.length) {
    return fail(`Keep at least one ${list.one} - an empty picker can't be answered.`);
  }
  if (clean.length > 30) {
    return fail("That's over 30 entries - keep it short enough to actually pick from.");
  }

  try {
    await setSetting(key, clean, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  for (const path of list.revalidate) revalidatePath(path);
  return { saved: true };
}

/**
 * Add ONE condition to the grades ladder, from the booking form.
 *
 * The one settings write a VA may make (Jaime, 2026-10-02): booking a meetup
 * now requires a condition per line, and the person on the phone has to be
 * able to record "cracked back" without an admin in the loop. Deliberately
 * ADDITIVE ONLY — append to the end, never rename, reorder or remove — so the
 * worst a stray tap can do is add a word; pruning stays on /settings, admin
 * only, through saveNameListAction above. Same bounds as that action, and a
 * case-insensitive duplicate returns the existing spelling rather than
 * refusing: "adding" a condition that already exists is the right answer, not
 * an error.
 *
 * Gated on writing /new rather than on admin: it is the booking form's
 * action, and whoever may book may name a condition.
 *
 * @returns {Promise<{grades: string[], name: string} | {error: string}>}
 */
export async function addGradeAction(name) {
  const staff = await requireStaff();
  if (!canWrite(staff.role, "/new")) return fail("You can't add conditions.");

  const clean = String(name ?? "").trim();
  if (!clean) return fail("Type the condition first.");
  if (clean.length > 40) return fail("Keep a condition under 40 characters.");

  const grades = await getGrades();
  const existing = grades.find((g) => g.toLowerCase() === clean.toLowerCase());
  if (existing) return { grades, name: existing };
  if (grades.length >= 30) {
    return fail(
      "The condition list already has 30 entries - ask an admin to prune it on Settings.",
    );
  }

  const next = [...grades, clean];
  try {
    await setSetting(GRADES_KEY, next, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  for (const path of NAME_LISTS[GRADES_KEY].revalidate) revalidatePath(path);
  return { grades: next, name: clean };
}

/**
 * Save the meetup location — the address every booking confirmation and
 * reminder carries. Used to be OFFICE_* env, which meant a redeploy to move
 * the meetup spot; now the setting wins and env is only the fallback
 * (lib/business.js).
 *
 * ADMIN ONLY, same reasoning as above: app_settings has no write policy, so
 * this action plus the service role is the entire write path. The checks
 * (street required, two-letter state, GSM-7 fold) live in domain/office.js
 * so the card can preview exactly the line that will be stored.
 *
 * @param {{street?: string, street2?: string, city?: string, state?: string, zip?: string}} input
 */
export async function saveOfficeAddressAction(input) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can change the meetup location.");

  const checked = validateOfficeAddress(input);
  if (checked.error) return fail(checked.error);

  try {
    await setSetting(OFFICE_ADDRESS_KEY, checked.value, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  // Where the line is RENDERED: the new-order form's meetup card and this
  // page. Order detail (send previews) and the sweeps re-read on their next
  // request; nothing caches the setting beyond one render.
  revalidatePath("/employee/settings");
  revalidatePath("/employee/new");
  // The canonical spelling back to the card, so what the fields show after
  // Save is what was stored (folded, state upper-cased), not what was typed.
  return { saved: true, value: checked.value, line: addressLine(checked.value) };
}

/**
 * Mute or unmute the alert chime for admins (Jaime, 2026-10-04): the admin
 * is not the one answering texts, and the two-note chime on every reply and
 * every lead is noise to them — while the VA, whose job it is, must keep
 * hearing it. So the switch silences ONE ROLE, and only the sound: the
 * sockets, the live refresh and the bell badge are untouched.
 *
 * ADMIN ONLY, same reasoning as every action above.
 *
 * @param {boolean} muted
 */
export async function saveAdminSoundMutedAction(muted) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can change alert sounds.");

  // Strictly boolean: the reader only honours `true`, so anything else a
  // direct POST sends is stored as the safe answer, sound on.
  const value = muted === true;
  try {
    await setSetting(ADMIN_SOUND_MUTED_KEY, value, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  // The LAYOUT reads this one (it feeds the shell's alert listeners), so the
  // whole staff tree revalidates, not a page: the tab that flipped the switch
  // goes quiet on this response rather than on its next hard reload.
  revalidatePath("/employee", "layout");
  return { saved: true, muted: value };
}

/**
 * Save how incoming calls are handled, and the sentence "message" mode
 * speaks (Jaime, 2026-10-04: "I don't even wanna answer the phone, just auto
 * say all of our employees are busy... text us"). On /settings rather than in
 * env or code because both halves are things an owner changes on a whim - the
 * wording today, back to ringing phones the week a second person is hired -
 * and neither should wait on a deploy.
 *
 * ADMIN ONLY, same reasoning as every action above. The checks live in
 * domain/phone-menu.js; the webhook reads the value on each call, so there is
 * nothing to revalidate but this page.
 *
 * @param {{mode?: string, message?: string}} input
 */
export async function saveIncomingCallsAction(input) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can change how calls are handled.");

  const checked = validateIncomingCalls(input);
  if (checked.error) return fail(checked.error);

  try {
    await setSetting(INCOMING_CALLS_KEY, checked.value, staff.name);
  } catch (err) {
    return settingSaveError(err);
  }

  revalidatePath("/employee/settings");
  // The canonical value back to the card (whitespace collapsed), so the box
  // shows what callers will hear rather than what was typed.
  return { saved: true, value: checked.value };
}

/** One save failure, translated. The missing table is the expected first-run
 * state: migrations are applied by hand here, and the save is the moment
 * somebody finds out. */
function settingSaveError(err) {
  const msg = String(err?.message || err);
  if (/app_settings/.test(msg) || /42P01|PGRST205|PGRST204/.test(`${err?.code} ${msg}`)) {
    return fail(
      "The settings table doesn't exist yet - run supabase/migrations/0001_init.sql " +
        "in the Supabase SQL editor, then save again.",
    );
  }
  return fail(`Could not save: ${msg}`);
}

/** One {start, end} pair as a canonical snapped window, or a named fail(). */
function readWindow(value, label) {
  const startMin = slotOf(value?.start);
  const endMin = slotOf(value?.end);
  if (startMin === null || endMin === null) return fail(`Give ${label}'s times as HH:MM.`);
  // A time input can't produce 25:00, but a direct POST can.
  if (endMin > 24 * 60) return fail(`${label}'s times aren't clock times.`);
  if (startMin >= endMin) {
    return fail(`${label}'s opening time has to be before its closing time.`);
  }
  return { start: slotValue(startMin), end: slotValue(endMin) };
}
