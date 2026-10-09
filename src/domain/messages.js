import { firstNameOf, fmtApptTime } from "./format";
import { formatKey } from "./dates";
import { displayStage, isWalkIn } from "./orders";
import { REMINDER_OPT_OUT_KEYWORD, GOOGLE_REVIEW_URL } from "./constants";

/**
 * Canonical SMS copy. Each template takes an order and returns the message
 * body. Kept free of side effects so they can be previewed in the UI and sent
 * from the server identically.
 *
 * KEEP THIS FILE INSIDE GSM-7. One character outside that alphabet (an em
 * dash, a curly quote, an ellipsis, an emoji) silently re-encodes the WHOLE
 * message as UCS-2, cutting a segment from 153 characters to 67 and roughly
 * doubling what every send costs. Nothing in the app surfaces it; it shows up
 * on the Twilio bill. Use a plain hyphen, three dots, and straight quotes.
 *
 * `node scripts/check-sms-encoding.mjs` enforces this over the whole file,
 * comments included, so the rule stays visible where the copy is edited.
 *
 * Every send here is about a MEETUP - the only kind of order. Received and
 * paid have NO templates on purpose: the handover is in person, a human just
 * said "got it" and handed over the money, and announcesStage() in
 * domain/orders.js refuses those sends before a template is ever asked for.
 */

/**
 * The body of an appointment confirmation, in the customer's own terms.
 *
 * Dates are stored as YYYY-MM-DD and times as 24-hour HH:MM, neither of
 * which anyone wants to read in a text, so both are formatted for humans
 * here. (Reminder wording lives in the appt_* templates below - reminders
 * are automatic and speak in "tomorrow"/"today" terms, not full dates.)
 *
 * @param {object} s the order
 * @param {string} [officeLine] one-line address of the meetup spot
 */
function appointmentBody(s, officeLine) {
  const when = [formatPickupDate(s.pickupDate), fmtApptTime(s.pickupTime)]
    .filter(Boolean)
    .join(" at ");

  const where = officeLine ? ` at ${officeLine}` : "";
  const visit = `Come see us${where} and get paid for your device!`;
  if (!when) return `We've got you down for a visit. ${visit}`;
  return `You're booked in for ${when}. ${visit}`;
}

/**
 * YYYY-MM-DD -> "Monday, Aug 3". Returns the raw value if unparseable.
 *
 * formatKey, not parseLocalDate + an explicit timeZone: this text goes
 * straight into the customer's confirmation text, sent from a Vercel
 * function running on UTC - whoever triggers the send (Jaime, or the remote
 * VA on a different clock entirely) must never change which day the
 * customer is told, and parseLocalDate's "local midnight" being the
 * SERVER's UTC midnight is exactly what used to roll this back to the
 * previous day on every send (caught 2026-10-03 - an Oct 3 pickup texted
 * as "Oct 2"). See domain/dates.js#formatKey for why.
 */
export function formatPickupDate(value) {
  return formatKey(value, { weekday: "long", month: "short", day: "numeric" });
}

export const TEMPLATES = {
  /**
   * Confirmation when a meetup is booked. Usually the FIRST text a customer
   * receives from us, so it carries the opt-out line (CTIA first-message
   * guidance); the recurring reminders carry their own from PAUSE's side.
   */
  pickup_scheduled: (s, { officeLine } = {}) =>
    `Hi ${firstNameOf(s.name)}, this is CLT Buyback. ${appointmentBody(s, officeLine)} Reply here if you need to change it. Reply STOP to opt out.`,

  /**
   * The three AUTOMATIC appointment reminders (domain/appointments.js decides
   * when each is due; the sweep sends them). Each says the moment in the
   * customer's terms - "tomorrow", "today", "about 30 minutes" - because
   * repeating the full date three times reads like the same robot text three
   * times, and the third one especially has one job: we're about to meet.
   */
  appt_day_before: (s, { officeLine } = {}) => {
    const time = fmtApptTime(s.pickupTime);
    const where = officeLine ? ` at ${officeLine}` : "";
    return `Hi ${firstNameOf(s.name)}, a reminder from CLT Buyback - you're stopping by tomorrow${time ? ` at ${time}` : ""}${where}. Reply here if you need to change it.`;
  },

  appt_morning_of: (s, { officeLine } = {}) => {
    const time = fmtApptTime(s.pickupTime);
    const where = officeLine ? ` at ${officeLine}` : "";
    return `Hi ${firstNameOf(s.name)}, this is CLT Buyback - we'll see you today${time ? ` at ${time}` : ""}${where}. Reply here if anything changes.`;
  },

  appt_soon: (s, { officeLine } = {}) => {
    const where = officeLine ? ` at ${officeLine}` : "";
    return `Hi ${firstNameOf(s.name)}, this is CLT Buyback - we're ready for you${where}, see you in about 30 minutes!`;
  },

  /**
   * The appointment MOVED.
   *
   * Its own template rather than re-sending the confirmation, because the
   * one thing this message has to do is signal a change - a customer who
   * reads "you're booked in for Saturday" as the same text they got last
   * week will turn up on Thursday. "New time" says it in two words.
   */
  pickup_rescheduled: (s, { officeLine } = {}) =>
    `Hi ${firstNameOf(s.name)}, this is CLT Buyback with a new time for you. ${appointmentBody(s, officeLine)} Reply here if that doesn't work. Thanks!`,

  /**
   * Sent when a no-show is reported (see STOP_OUTCOMES.announces - a
   * customer who cancelled to a person's face gets silence, on purpose).
   */
  visit_missed: (s) =>
    `Hi ${firstNameOf(s.name)}, this is CLT Buyback. We missed you today - no problem at all. Reply here and we'll set up a time that works.`,

  /**
   * The once-only second touch, two days after a no-show text went
   * unanswered. Asks the question we actually need answered - are they still
   * selling - and offers the way out, because this is exactly the kind of
   * recurring automated message that gets a number filtered as spam.
   */
  stop_follow_up: (s) =>
    `Hi ${firstNameOf(s.name)}, this is CLT Buyback checking back in - we didn't get to meet up the other day. Still want to sell? Reply here and we'll set up a new time. Reply ${REMINDER_OPT_OUT_KEYWORD} if you'd rather we didn't check in.`,

  /**
   * The once-ever Google review ask, one business day after a customer's
   * FIRST successful payout (see needsReviewAsk in domain/orders.js - which
   * refuses while GOOGLE_REVIEW_URL is empty, so this cannot send until the
   * listing link is pasted into constants.js).
   *
   * "If it WAS a 5-star experience" is conditional on purpose: it plants the
   * number without instructing anyone to leave it, which is the defensible
   * end of Google's no-soliciting-positive-reviews line. No opt-out line - a
   * once-ever message deep into an existing thread, not a first touch and
   * not recurring.
   */
  review_request: (s) =>
    `Hi ${firstNameOf(s.name)}, thanks from CLT Buyback! If it was a 5-star experience, a Google review means a lot: ${GOOGLE_REVIEW_URL}`,

  /**
   * Sent automatically when a call rings out unanswered.
   *
   * A missed call from someone selling a phone is a lead that will otherwise
   * ring the next buyer on their list. This turns it into a text thread,
   * which arrives in seconds rather than whenever somebody works the
   * callback list. It PROMISES NO CALLBACK and asks what they're selling
   * instead: the reply is the whole point, and "what are you selling" makes
   * the first reply a quotable answer rather than "hi". No name - a caller
   * we've never met has none on file.
   */
  missed_call: () =>
    // A caller's FIRST text, so it carries the opt-out line - same first-
    // message rule as the confirmation above. Keep this inside ONE GSM-7
    // segment (160 chars): every missed call sends it, so a second segment
    // doubles a recurring cost. Recount before adding a word.
    `Sorry we missed you! This is CLT Buyback. Texting is fastest - tell us what you're selling and we'll quote you right here. Reply STOP to opt out.`,

  /** Confirms an opt-out, so the keyword is never met with silence. */
  reminder_cancelled: (s) =>
    `Thanks ${firstNameOf(s.name)} - we've stopped the automatic reminders for this order. You can always text us here.`,
};

/**
 * The message that belongs to an order's CURRENT stage, or null if that
 * stage has nothing to say.
 *
 * Keyed off displayStage rather than the raw status, which is the rule the
 * whole codebase follows: for a booked meetup nothing advances when the
 * appointment is made, so the confirmation IS the awaiting-stage message -
 * that is what "Resend text" resends. A walk-in was never booked and a
 * received/paid order was handled face to face; none of them has a stage
 * message.
 */
export function stageTemplate(order) {
  const stage = displayStage(order);
  if (stage === "awaiting") return isWalkIn(order) ? null : TEMPLATES.pickup_scheduled;
  return TEMPLATES[stage] || null;
}
