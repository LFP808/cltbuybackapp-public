import { sendSms, isSmsTestMode, SmsError, SmsBlockedError } from "@/lib/twilio/client";
import { addMessage, addSystemMessage } from "@/lib/repositories/messages";
import { isSmsOptedOut, setSmsOptedOut } from "@/lib/repositories/contact-notes";
import { normPhone } from "@/domain/format";
import { foldToGsm7 } from "@/domain/sms";
import { isMessagingEnabled, MESSAGING_OFF_REASON } from "@/domain/mode";

/**
 * The one way to text a customer.
 *
 * Every outbound path — stage templates, manual replies, reminders, the PAUSE
 * confirmation — goes through here, because each needs the same three things
 * and any one of them being skipped is a silent bug:
 *
 *   1. Refuse to send to someone who texted STOP. The carrier blocks it
 *      anyway; asking first turns an opaque rejection into a clear message.
 *   2. Record Twilio's SID, so the delivery webhook can find the row later.
 *   3. Log the message only when Twilio actually accepted it, so the thread
 *      never shows staff a message the customer was never sent.
 */

/**
 * The user-safe message for a failed send, or null if this is a genuine fault
 * that should keep propagating.
 *
 * Actions need this because a send can fail for a reason the customer caused,
 * and those must be RETURNED, not thrown — a thrown message is stripped in a
 * production build. The STOP case is not a rare race: the opt-out flag is
 * WRITTEN by a failed send (Twilio only tells us when we try), so the first
 * send after someone texts STOP cannot have been hidden by the composer. That
 * path runs for every opt-out exactly once, and it is precisely when the
 * carefully worded "they can lift it by texting START" needs to survive.
 *
 * @param {unknown} err
 * @returns {string|null}
 */
export function userFacingSendError(err) {
  if (err instanceof MessagingOffError) return err.message;
  // Our own fence, not the carrier's. Shown plainly so the reader knows the
  // send was refused HERE and nothing reached Twilio.
  if (err instanceof SmsBlockedError) return err.message;
  if (err instanceof OptedOutError) return err.message;
  // A carrier rejection — unreachable number, a landline sent an MMS. Twilio's
  // own wording is the most useful thing we can show. A missing/!misconfigured
  // Twilio is NOT this: that has no `code` and stays a fault.
  if (err instanceof SmsError) return err.message;
  return null;
}

/**
 * Raised when texting is switched off deployment-wide.
 *
 * A configuration state, not a fault and not the customer's doing — so it
 * carries a message safe to show and is RETURNED to the caller like an
 * expected failure, never surfaced as a crash.
 */
export class MessagingOffError extends Error {
  constructor() {
    super(MESSAGING_OFF_REASON);
    this.name = "MessagingOffError";
  }
}

/** Raised when the customer has opted out; carries a message safe to show. */
export class OptedOutError extends Error {
  constructor(phone) {
    super("This customer replied STOP and can no longer be texted.");
    this.name = "OptedOutError";
    this.phone = phone;
  }
}

/**
 * Send a text and record it against the conversation.
 *
 * @param {object} input
 * @param {string} input.phone
 * @param {string} input.body
 * @param {string} [input.orderId]
 * @param {string|null} [input.mediaUrl]
 * @param {boolean} [input.auto]      templated/automatic rather than typed
 * @param {string} [input.sentBy]     staff name for attribution
 * @param {string} [input.sentByRole] their role AT SEND TIME — recorded, not
 *                                    looked up later, so a promotion never
 *                                    rewrites who sent an old message
 * @param {boolean} [input.system]    true when no employee session exists
 *                                    (webhooks, background jobs) — writes with
 *                                    the service role instead of failing RLS
 * @returns {Promise<import('@/domain/types').Message>}
 */
export async function sendAndLog({
  phone,
  body,
  orderId,
  mediaUrl = null,
  auto = false,
  sentBy,
  sentByRole = null,
  system = false,
}) {
  const to = normPhone(phone);
  if (to.length !== 10) throw new Error("A valid 10-digit phone number is required.");

  // Folded HERE as well as inside sendSms, so the thread logs the exact words
  // that went over the wire — an audit trail reading "María" above a message
  // that arrived saying "Maria" is a small lie that costs trust later.
  body = foldToGsm7(body);

  /**
   * MESSAGING OFF — before the opt-out read, before anything is written.
   *
   * The whole point of the switch is that no row appears: a logged message is
   * a claim we said something, and weeks later nothing distinguishes it from
   * one that was actually delivered.
   *
   * The two kinds of caller need opposite treatment. An AUTOMATIC text has no
   * audience waiting on it — announcesStage already decides most of them are
   * not worth sending — so it returns quietly, and an order does not sprout a
   * "the text failed" banner over a setting somebody chose on purpose. A
   * TYPED message has a person who just pressed Send and is owed an answer, so
   * it refuses out loud through the same path every other send failure uses.
   */
  if (!isMessagingEnabled()) {
    if (auto) return null;
    throw new MessagingOffError();
  }

  if (await isSmsOptedOut(to)) throw new OptedOutError(to);

  const testMode = isSmsTestMode();

  let result;
  try {
    result = await sendSms({ to: `+1${to}`, body, mediaUrl });
  } catch (err) {
    // Twilio only tells us about a STOP when we try to send. Record it so the
    // next attempt is refused up front and the UI can explain why.
    if (err instanceof SmsError && err.isOptOut) {
      await setSmsOptedOut(to, true).catch(() => {});
      throw new OptedOutError(to);
    }
    throw err;
  }

  const record = system ? addSystemMessage : addMessage;
  return record({
    phone: to,
    orderId,
    body,
    mediaUrl,
    auto,
    testMode,
    sentBy,
    sentByRole,
    providerSid: result?.sid ?? null,
    // Twilio's initial verdict ("queued"/"accepted"); the status webhook
    // upgrades this to delivered, or to failed with a reason.
    deliveryStatus: result?.status ?? null,
  });
}
