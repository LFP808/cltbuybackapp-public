/**
 * Device inquiries — leads from the marketing site's "sell your device"
 * quote wizard, triaged on /leads. See lib/repositories/device-inquiries.js
 * for the one unauthenticated write path this table has.
 */

export const INQUIRY_STATUSES = ["new", "contacted", "closed"];

export function isValidStatus(status) {
  return INQUIRY_STATUSES.includes(status);
}

/** Validate a submission before it's written. Returns a fieldErrors object, empty when clean. */
export function validateDeviceInquiry({ name, phone } = {}) {
  const errors = {};
  if (!String(name || "").trim()) errors.name = "Name is required.";
  if (!String(phone || "").trim()) errors.phone = "Phone is required.";
  return errors;
}

/** One-line label for a list row: the device, then who's selling it. */
export function summarizeInquiry(inquiry) {
  const device = inquiry?.model || inquiry?.brand || "Device";
  const count = Number(inquiry?.itemCount) || 1;
  const suffix = count > 1 ? ` (${count})` : "";
  return `${device}${suffix} — ${inquiry?.name || "Unknown"}`;
}

/**
 * Short marketing-channel label from the wizard's captured ad_params
 * ("gclid=…", "utm_source=google&utm_medium=cpc", …), or null when the visit
 * carried no click ID or UTM tag (organic/direct — the common case).
 */
export function describeAdSource(adParams) {
  if (!adParams) return null;
  const params = new URLSearchParams(adParams);
  if (params.get("gclid") || params.get("gbraid") || params.get("wbraid")) return "Google Ads";
  const source = params.get("utm_source");
  if (source) {
    const label = source.charAt(0).toUpperCase() + source.slice(1);
    const medium = params.get("utm_medium");
    return medium ? `${label} · ${medium}` : label;
  }
  if (params.get("keyword")) return "Search";
  return "Ad";
}

/**
 * What a new inquiry writes into contact_notes.lead_source (via
 * setLeadSourceIfEmpty — see lib/repositories/device-inquiries.js), so the
 * Source & payment panel and the messages-inbox badge both know this contact
 * came from the site's quote wizard, with the ad channel folded in when one
 * was captured.
 */
export function inquiryLeadSourceLabel(adParams) {
  const adSource = describeAdSource(adParams);
  return adSource ? `Website (${adSource})` : "Website form";
}
