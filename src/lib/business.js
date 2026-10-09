import { getSetting, OFFICE_ADDRESS_KEY } from "@/lib/repositories/settings";
import { addressLine, normalizeOfficeAddress } from "@/domain/office";

/**
 * The business's one address: where meetups happen.
 *
 * The DTS ancestor kept two (a mailing address for labels and an office for
 * walk-ins); with no labels there is nothing to mail, so officeAddress() is
 * the whole story.
 *
 * THE ADDRESS IS A SETTING FIRST, ENV SECOND. The admin saves it on /settings
 * (app_settings `office_address`), and that wins whenever it is set; the
 * OFFICE_ / BUSINESS_ env is only the fallback for a database nobody has
 * saved to yet, so an existing deploy keeps its address until someone types
 * one in. Identity (name, company, phone) stays in env: it is printed on
 * invoices and changes when the business does, not when the meetup spot does.
 *
 * Server-only: this reads the database and unprefixed env, so it must never
 * be imported by a client component. Pages pass what they need down as props.
 */

/** The env-configured address — what a fresh database falls back to. */
function envOfficeAddress() {
  return {
    street: process.env.OFFICE_STREET || process.env.BUSINESS_STREET || "",
    street2: process.env.OFFICE_STREET2 || process.env.BUSINESS_STREET2 || "",
    city: process.env.OFFICE_CITY || process.env.BUSINESS_CITY || "Charlotte",
    state: process.env.OFFICE_STATE || process.env.BUSINESS_STATE || "NC",
    zip: process.env.OFFICE_ZIP || process.env.BUSINESS_ZIP || "",
  };
}

/**
 * What the business calls itself - env, no database. Its own export because
 * the phone menu's greeting needs the name on every incoming call and should
 * not pay for an address read to get it.
 */
export function businessName() {
  return process.env.BUSINESS_NAME || "CLT Buyback";
}

/**
 * The place customers come to sell, plus the identity lines documents print.
 *
 * `source` says which won — "settings" or "env" — so /settings can tell the
 * admin whether what they are looking at is theirs or the server's.
 *
 * @param {{system?: boolean}} [opts] `system: true` reads with the service
 *   role — REQUIRED from the sweeps, which have no session (see getSetting).
 */
export async function officeAddress({ system = false } = {}) {
  const stored = await getSetting(OFFICE_ADDRESS_KEY, { system });
  const fallback = envOfficeAddress();
  const address = normalizeOfficeAddress(stored, fallback);
  return {
    name: businessName(),
    company: process.env.BUSINESS_COMPANY || "CLT Buyback",
    phone: process.env.OFFICE_PHONE || process.env.BUSINESS_PHONE || "",
    ...address,
    source: address === fallback ? "env" : "settings",
  };
}

/** One-line address, for customer-facing copy (confirmation texts, reminders). */
export async function officeAddressLine(opts) {
  return addressLine(await officeAddress(opts));
}
