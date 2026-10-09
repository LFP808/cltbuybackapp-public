import { attentionCount, URGENT } from "./attention";

/**
 * The one text a morning is worth.
 *
 * A STAFF message, not a customer one, so the GSM-7 rule that governs
 * domain/messages.js does not strictly bind here - but it stays inside GSM-7
 * anyway, because it goes out over the same Twilio number and the same bill. An
 * em dash would silently re-encode this as UCS-2, halve the segment size, and
 * roughly double what a daily message costs over a year.
 *
 * Kept deliberately short. The digest exists to answer "is there anything I
 * have to deal with today", and the app is where you deal with it - a text that
 * reproduces the whole worklist is one nobody finishes reading and one that
 * costs four segments. Urgent lines lead; the rest are summarised.
 */

/** Nothing waiting is worth saying out loud - once, not every morning. */
export const ALL_CLEAR = "Nothing waiting this morning. Nothing overdue, nothing unpaid.";

/**
 * @param {ReturnType<import('./attention').buildAttention>} sections
 * @param {Date} [today]
 * @param {string[]} [failedReads] sources the repository could not read
 * @returns {string|null} null when there is nothing worth a text
 */
export function digestText(sections, today = new Date(), failedReads = []) {
  if (!sections.length && !failedReads.length) return null;

  const day = today.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const urgent = sections.filter((s) => s.severity === URGENT);
  const rest = sections.filter((s) => s.severity !== URGENT);

  const lines = [`Morning check, ${day}:`];
  for (const s of urgent) lines.push(s.label);
  // The non-urgent work is a count, not a list. Four separate lines about boxes
  // aging is how the urgent line at the top stops being read.
  if (rest.length) {
    lines.push(rest.map((s) => s.label).join(", "));
  }
  // A read that failed gets said out loud, because this message's silence
  // means "all clear" by design - a digest blind to invoices must not imply
  // there are no unpaid ones. Plain hyphen: this text stays GSM-7.
  if (failedReads.length) {
    lines.push(
      `Could not check ${failedReads.join(", ")} - look in the app, this text is blind there today.`,
    );
  }
  lines.push("Open the app for the details.");

  return lines.join("\n");
}

/**
 * Whether this morning deserves a message at all.
 *
 * A digest that arrives every single day, including the days it says "nothing",
 * becomes a notification people swipe away without reading - and then they swipe
 * away the one that mattered. Silence is the signal that nothing is wrong.
 *
 * Which is exactly why a failed read forces a send: the one morning the digest
 * couldn't look is the one morning its silence would lie.
 */
export function shouldSendDigest(sections, failedReads = []) {
  return attentionCount(sections) > 0 || failedReads.length > 0;
}
