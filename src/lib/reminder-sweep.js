import {
  needsStopFollowUp,
  FAILED_STOP_FOLLOW_UP_ACTION,
  needsReviewAsk,
  REVIEW_ASK_ACTION,
} from "@/domain/orders";
import {
  FAILED_STOP_FOLLOW_UP_DAYS,
  REVIEW_ASK_WINDOW_DAYS,
  GOOGLE_REVIEW_URL,
} from "@/domain/constants";
import { payoutAt } from "@/domain/cash";
import { TEMPLATES } from "@/domain/messages";
import { isMessagingEnabled } from "@/domain/mode";
import { sendAndLog } from "@/lib/messaging";
import {
  listStopFollowUpCandidates,
  listReviewAskCandidates,
  hasEarlierPayout,
  hasRepliedSince,
  patchOrderAsSystem,
} from "@/lib/repositories/reminders";

/**
 * The daily CRM sweep: two once-only texts.
 *
 *   - the "still want to sell?" follow-up, two days after a missed meetup
 *   - the Google review ask — fired immediately at payout (see
 *     attemptImmediateReviewAsk), this lane is only its same-day safety net
 *
 * The label-reminder lanes this file used to run died with mail-ins; these two
 * survived because they are about people, not packages. The days live in
 * domain/constants.js and the rules that read them in domain/orders.js; this
 * file only decides which text an order is due for today, and sends it.
 *
 * THIS USED TO BE A BUTTON. Nothing that chases a customer should depend on
 * somebody remembering to press something — a follow-up exists because the
 * person went quiet, which is exactly when nobody is thinking about them.
 */

/** Why a candidate was passed over, in words a person can act on. */
export const SKIP_REASONS = {
  no_phone: "no phone number on file",
  moved_on: "the order changed status mid-sweep",
  followup_replied:
    "customer already replied since the missed meetup - a person answers, not a template",
  not_due_followup: "already followed up, rebooked, or not two days yet",
  not_first_payout: "a repeat customer - the review ask is for first-timers",
  review_not_due: "already asked, opted out, or not a business day yet",
  review_replied: "customer texted us since the payout - a person should ask, not a template",
};

/**
 * Ask once, two days after a missed meetup, whether they still want to sell.
 *
 * THE ACTIVITY ENTRY IS THE ONCE — stopFollowUpSentAt() reads it back, so it
 * is written only after the text is really gone: a follow-up nobody received
 * must not use up the only slot. needsStopFollowUp() is re-checked here
 * because the repository's cut is coarse (it cannot see the activity trail or
 * a future pickupDate), and the reply check is as late as possible so an
 * answer that lands mid-sweep wins.
 */
async function followUpOne(order) {
  if (!needsStopFollowUp(order)) return "not_due_followup";
  if (await hasRepliedSince(order.phone, order.stopOutcomeAt)) return "followup_replied";

  await sendAndLog({
    phone: order.phone,
    orderId: order.id,
    body: TEMPLATES.stop_follow_up(order),
    auto: true,
    sentBy: "Automatic reminder",
    system: true,
  });

  const activity = [
    ...(order.activity || []),
    { action: FAILED_STOP_FOLLOW_UP_ACTION, by: "Automatic reminder", at: Date.now() },
  ];
  const ok = await patchOrderAsSystem(order.id, { activity }, "awaiting");
  return ok ? "followed_up" : "moved_on";
}

/**
 * Everything that disqualifies a review ask EXCEPT having already sent it in
 * this pass — needsReviewAsk() only, the rest needs other orders (first
 * payout) or the message thread (replied since). Shared by the sweep, which
 * needs a reason to report, and attemptImmediateReviewAsk below, which only
 * needs yes/no.
 */
async function reviewAskIneligibleReason(order, now) {
  if (!needsReviewAsk(order, now)) return "review_not_due";
  // FIRST payout only. Checked before the reply check because it is the
  // cheaper disqualifier and never changes.
  if (await hasEarlierPayout(order.phone, order.id, payoutAt(order))) {
    return "not_first_payout";
  }
  // Anything they've said since the payout means a person answers first —
  // "leave us a review" landing mid-complaint is how a one-star review gets
  // written. Staff can always ask by hand.
  if (await hasRepliedSince(order.phone, payoutAt(order))) {
    return "review_replied";
  }
  return null;
}

/**
 * Fire the review ask the instant an order is marked paid, instead of
 * waiting for tomorrow's sweep — REVIEW_ASK_AFTER_BUSINESS_DAYS is 0 for
 * exactly this. Called from the server actions that write a "paid" status
 * (see advanceOrderAction / createOrderAction), right after the write
 * commits, the same spot a stage text would plug in.
 *
 * The daily sweep is still the safety net: if this throws, or never ran (a
 * walk-in inserted outside the app), needsReviewAsk() still finds the order
 * due and the sweep sends it same-day, since the threshold is 0.
 *
 * Returns null on success OR on a quiet skip (not first payout, already
 * asked, no link configured…) — only a real send failure returns a message,
 * the same contract as tryStageText, so a caller can surface it the same way
 * without treating "not eligible" as an error.
 */
export async function attemptImmediateReviewAsk(order, now = Date.now()) {
  if (await reviewAskIneligibleReason(order, now)) return null;
  const outcome = await reviewAskOne(order);
  return outcome === "review_asked" ? null : "The review request text could not be sent.";
}

/**
 * Send the once-ever Google review ask and log it. Shared by the immediate
 * attempt (right after payout) and this file's own fallback sweep — the
 * caller has already decided the order is due.
 *
 * THE ACTIVITY ENTRY IS THE ONCE — reviewAskedAt() reads it back, written
 * only after the text is really gone, the same rule as the stop follow-up:
 * an ask nobody received must not use up the only slot.
 */
async function reviewAskOne(order) {
  await sendAndLog({
    phone: order.phone,
    orderId: order.id,
    body: TEMPLATES.review_request(order),
    auto: true,
    sentBy: "Automatic reminder",
    system: true,
  });

  const activity = [
    ...(order.activity || []),
    { action: REVIEW_ASK_ACTION, by: "Automatic reminder", at: Date.now() },
  ];
  const ok = await patchOrderAsSystem(order.id, { activity }, "paid");
  return ok ? "review_asked" : "moved_on";
}

/**
 * Work today's candidates.
 *
 * Sequential rather than parallel: these are texts to real people through one
 * Twilio number, and a burst of concurrent sends is both easier to rate-limit
 * and harder to reason about when one fails.
 */
export async function runReminderSweep({ limit = 500, dry = false } = {}) {
  const now = Date.now();
  const result = {
    followedUp: 0,
    reviewAsked: 0,
    skipped: 0,
    failed: 0,
    candidates: 0,
    truncated: false,
    reasons: [],
    would: { followUp: [], reviewAsk: [] },
  };

  // First lane: missed meetups due their once-only "still want to sell?" text.
  const cutoff = now - FAILED_STOP_FOLLOW_UP_DAYS * 86400000;
  const stops = await listStopFollowUpCandidates(cutoff, limit);
  result.candidates += stops.length;
  // NOT SILENT. A run that hits its own rail must say so, or a cap looks
  // identical to "that was everyone".
  result.truncated = stops.length === limit;

  for (const order of stops) {
    try {
      if (!order.phone) {
        result.skipped += 1;
        note(result, order, "no_phone");
        continue;
      }
      if (!needsStopFollowUp(order, now)) {
        result.skipped += 1;
        note(result, order, "not_due_followup");
        continue;
      }
      if (dry) {
        result.would.followUp.push(order.name);
        result.followedUp += 1;
        continue;
      }
      const outcome = await followUpOne(order);
      if (outcome === "followed_up") result.followedUp += 1;
      else {
        result.skipped += 1;
        note(result, order, outcome);
      }
    } catch (err) {
      // One bad number must not abandon the rest of the run.
      console.error(`Stop follow-up failed on order ${order.id}:`, err?.message || err);
      result.failed += 1;
    }
  }

  // Second lane: the once-ever Google review ask. The REAL send now happens
  // immediately when an order is marked paid (attemptImmediateReviewAsk,
  // called from the server actions) — this lane only mops up what that
  // missed: a thrown error, a walk-in inserted outside the app. Same-day,
  // since REVIEW_ASK_AFTER_BUSINESS_DAYS is 0. The link is embedded in
  // domain/constants.js; the guard only exists so blanking that constant
  // turns the lane off rather than texting a broken ask.
  if (GOOGLE_REVIEW_URL) {
    const paidRecently = await listReviewAskCandidates(
      now - REVIEW_ASK_WINDOW_DAYS * 86400000,
      limit,
    );
    result.candidates += paidRecently.length;
    result.truncated = result.truncated || paidRecently.length === limit;

    for (const order of paidRecently) {
      try {
        const reason = await reviewAskIneligibleReason(order, now);
        if (reason) {
          result.skipped += 1;
          note(result, order, reason);
          continue;
        }
        if (dry) {
          result.would.reviewAsk.push(order.name);
          result.reviewAsked += 1;
          continue;
        }
        const outcome = await reviewAskOne(order);
        if (outcome === "review_asked") result.reviewAsked += 1;
        else {
          result.skipped += 1;
          note(result, order, outcome);
        }
      } catch (err) {
        console.error(`Review ask failed on order ${order.id}:`, err?.message || err);
        result.failed += 1;
      }
    }
  }

  return result;
}

/** One line per distinct reason, named so a person can act on it. */
function note(result, order, outcome) {
  const why = `${order.name}: ${SKIP_REASONS[outcome] || outcome}`;
  if (!result.reasons.includes(why)) result.reasons.push(why);
}

/** Whether the sweep can run at all. Messaging off means it must not send. */
export function sweepBlockedReason() {
  return isMessagingEnabled() ? null : "messaging is switched off";
}
