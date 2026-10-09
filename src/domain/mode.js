/**
 * Operating switches — what this deployment is currently willing to do.
 *
 * (The DTS ancestor also had a shipping-only MODE for its nationwide ad
 * launch; with one order type left there is nothing to fence off, and it was
 * removed rather than kept as a switch nobody can flip to anything.)
 */

/**
 * Is outbound messaging switched on at all?
 *
 * A THIRD STATE, above SMS_TEST_MODE, and the distinction matters:
 *
 *   MESSAGING_ENABLED=false  nothing happens. No send, and NO ROW WRITTEN.
 *   ...=true + SMS_TEST_MODE=true   logged to the thread, not delivered (QA)
 *   ...=true + SMS_TEST_MODE=false  really sent
 *
 * Test mode exists so the booking→confirmation flow can be exercised without
 * a Twilio account, and it writes the message to the customer's thread so you
 * can read what WOULD have gone out. That is exactly wrong for a deployment
 * that has no Twilio at all: weeks of messages sitting in threads that no
 * customer ever received, indistinguishable later from ones they did. A
 * record of a conversation that did not happen is worse than no record.
 *
 * DEFAULT ON — a missing variable means business as usual, because a
 * deployment nobody meant to silence going quiet is the failure with no
 * visible cause. The safety net for real sends stays SMS_TEST_MODE, which
 * defaults to "log, don't deliver".
 *
 * Server-only: pages hand the answer down as a prop rather than exposing a
 * NEXT_PUBLIC_ copy for the browser to disagree with.
 */
export function isMessagingEnabled(env = process.env) {
  return String(env.MESSAGING_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Numbers texting is allowed to reach, when the deployment is fenced in.
 *
 * Set SMS_ALLOWLIST to your own number when testing against a real Twilio
 * account, and leave it UNSET in production. Empty means no fence, which
 * keeps production behaviour exactly as it was and makes this impossible to
 * enable by accident: an allowlist that defaulted to something would
 * silently drop customer messages.
 *
 * Comma-separated, any format — the digits are what matter.
 */
export function smsAllowlist(env = process.env) {
  return String(env.SMS_ALLOWLIST || "")
    .split(",")
    .map((n) => n.replace(/\D/g, "").slice(-10))
    .filter((n) => n.length === 10);
}

/** Whether this number may be texted. True when no allowlist is configured. */
export function isSmsAllowed(phone, env = process.env) {
  const allowed = smsAllowlist(env);
  if (allowed.length === 0) return true;
  return allowed.includes(
    String(phone || "")
      .replace(/\D/g, "")
      .slice(-10),
  );
}

/** Why the composers are dark, in the words a staffer needs. */
export const MESSAGING_OFF_REASON =
  "Texting is off for this deployment — nothing is sent and nothing is recorded. " +
  "Set MESSAGING_ENABLED=true once Twilio is connected.";
