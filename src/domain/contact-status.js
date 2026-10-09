import { REMINDER_OPT_OUT_KEYWORD } from "./constants";

/**
 * The two ways a customer can ask us to stop, which are not the same thing.
 *
 *   STOP   → the CARRIER blocks us. Nothing we send arrives, including a reply
 *            to a question they asked. Only they can undo it, by texting START.
 *   PAUSE  → they are tired of the reminder nags. Ordinary conversation is
 *            still fine and still lands; only the automated chasing stops.
 *
 * The second word is REMINDER_OPT_OUT_KEYWORD and it used to be CANCEL, which
 * is one of Twilio's own carrier-level opt-out words — so the reply we invited
 * produced the outcome in the first line, not the second. Any replacement has
 * to stay off that list; see the constant.
 *
 * These were shown in different words in different places, and in half the
 * places you can type a message they were not shown at all — so an assistant
 * could write a careful reply to someone the carrier would never deliver it to.
 * One function, so every composer says the same thing.
 *
 * @param {{ smsOptedOut?: boolean, remindersCancelledAt?: number|string|null,
 *           statusUnknown?: boolean }} contact
 * @returns {{ kind: string, canText: boolean, title: string, detail: string } | null}
 */
export function contactRestriction(contact) {
  // FIRST, because it outranks everything below it: this one is about US, not
  // them. Telling someone "they replied STOP" while the deployment cannot text
  // anybody would send them chasing a customer problem that does not exist.
  if (contact?.messagingOff) {
    return {
      kind: "off",
      canText: false,
      title: "Texting is turned off right now.",
      detail:
        "Nothing is sent and nothing is recorded, so the thread stays honest. " +
        "Call them instead - it comes back on with the Twilio connection.",
    };
  }
  // We could not READ the opt-out state — distinct from having read it and
  // found nothing. This used to collapse into "not opted out", so the composer
  // quietly asserted a fact it did not have.
  //
  // Sending stays enabled on purpose. sendAndLog checks the opt-out with the
  // service role and throws if that read fails, so the server is the gate and
  // cannot be fooled by what this page believes; disabling here would only
  // take messaging away from every unaffected customer during the same blip.
  if (contact?.statusUnknown) {
    return {
      kind: "unknown",
      canText: true,
      title: "Couldn't check whether this customer opted out.",
      detail:
        "Send if you need to - it will be refused with a clear reason if they " +
        "replied STOP. Reloading usually clears this.",
    };
  }
  if (contact?.smsOptedOut) {
    return {
      kind: "blocked",
      canText: false,
      title: "This customer replied STOP.",
      detail:
        "The carrier blocks everything we send to them, including replies. " +
        "Only they can lift it, by texting START. Call them instead.",
    };
  }
  if (contact?.remindersCancelledAt) {
    return {
      kind: "no_reminders",
      canText: true,
      title: `They replied ${REMINDER_OPT_OUT_KEYWORD} to the reminders.`,
      detail: "Automatic chasing is off. You can still message them normally.",
    };
  }
  return null;
}
