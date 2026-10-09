import { foldToGsm7, isGsm7, nonGsmCharacters } from "./sms";

/**
 * The meetup spot — the one address customers are sent to.
 *
 * It is a SETTING (app_settings `office_address`, edited on /settings), not a
 * deploy-time constant: moving meetup spots used to mean editing OFFICE_* in
 * the hosting dashboard and redeploying, which is nobody's idea of "we're at
 * the other Starbucks now". lib/business.js merges the stored value with the
 * server's env fallback; this module is the pure part — the shape, what a
 * valid one is, and the one-line form the texts carry — so the settings card
 * can preview exactly what a customer will read without a round trip.
 *
 * @typedef {import('./types').OfficeAddress} OfficeAddress
 */

/** Field order and the limits the save action enforces. */
export const OFFICE_ADDRESS_FIELDS = ["street", "street2", "city", "state", "zip"];

const MAX = { street: 80, street2: 40, city: 40 };

/**
 * The stored setting, cleaned, or `fallback` when nothing usable is stored.
 *
 * All-or-nothing on purpose: the setting is what the admin saved, as a whole.
 * Filling a blank city from the env would show one address on /settings and
 * text another, and the card promises "this is what customers get".
 *
 * @param {unknown} value  the raw app_settings value (or null)
 * @param {OfficeAddress} fallback
 * @returns {OfficeAddress}
 */
export function normalizeOfficeAddress(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const out = {};
  for (const key of OFFICE_ADDRESS_FIELDS) out[key] = String(value[key] ?? "").trim();
  // A row somebody blanked is "unset", not "an address with no street": the
  // texts would say "Come see us at Charlotte, NC" and sound like a riddle.
  return out.street ? out : fallback;
}

/**
 * One line, for customer-facing copy: "123 Main St Suite 4, Charlotte, NC".
 * No ZIP — nobody reads one in a text, and the segment is better spent.
 *
 * @param {Partial<OfficeAddress>} a
 */
export function addressLine(a = {}) {
  return [[a.street, a.street2].filter(Boolean).join(" "), a.city, a.state]
    .filter(Boolean)
    .join(", ");
}

/**
 * Check and canonicalize what the settings form sent. Returns `{ error }`
 * naming the field, or `{ value }` ready to store.
 *
 * Every field is folded to GSM-7 FIRST (an em dash or a curly apostrophe
 * pasted from Google Maps would otherwise ride along into every confirmation
 * and reminder); the send path folds too, so storing the folded spelling just
 * makes /settings show the same text the customer sees. A character with no
 * fold (an emoji, say) is refused by name rather than stored.
 *
 * @param {Partial<Record<keyof OfficeAddress, unknown>>} input
 * @returns {{ error: string } | { value: OfficeAddress }}
 */
export function validateOfficeAddress(input) {
  // A server action is a public POST: the body can be anything, not just
  // what the card sends.
  const src = input && typeof input === "object" ? input : {};
  const value = {};
  for (const key of OFFICE_ADDRESS_FIELDS) {
    value[key] = foldToGsm7(String(src[key] ?? ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!value.street) return { error: "Street is required - it's the line customers are texted." };
  if (!value.city) return { error: "City is required." };
  for (const [key, max] of Object.entries(MAX)) {
    if (value[key].length > max) {
      return { error: `${LABELS[key]} is too long - ${max} characters max.` };
    }
  }

  // The state goes into a text verbatim, so it has to be the two-letter code
  // a phone keyboard and a text both expect, not "North Carolina".
  value.state = value.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(value.state)) {
    return { error: "State needs the two-letter code, like NC." };
  }

  if (value.zip && !/^\d{5}(-\d{4})?$/.test(value.zip)) {
    return { error: "ZIP should be 5 digits (or ZIP+4)." };
  }

  for (const key of OFFICE_ADDRESS_FIELDS) {
    if (!isGsm7(value[key])) {
      const bad = nonGsmCharacters(value[key]).join(" ");
      return {
        error: `${LABELS[key]} has a character texts can't carry cheaply (${bad}) - use plain letters.`,
      };
    }
  }

  return { value };
}

const LABELS = {
  street: "Street",
  street2: "Suite / unit",
  city: "City",
  state: "State",
  zip: "ZIP",
};
