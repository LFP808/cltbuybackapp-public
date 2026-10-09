import {
  STAGES,
  FAILED_STOP_FOLLOW_UP_DAYS,
  REVIEW_ASK_AFTER_BUSINESS_DAYS,
  REVIEW_ASK_WINDOW_DAYS,
  GOOGLE_REVIEW_URL,
} from "./constants";
import { dayKey, businessDaysBetween } from "./dates";
import { payoutAt } from "./cash";

/**
 * Stage/lifecycle logic for an order. Pure functions — no side effects — so
 * they can drive the dashboard and any server-side reporting from a single
 * source of truth.
 *
 * Every order is an in-person handover at our place: either a MEETUP someone
 * booked, or a WALK-IN that skipped the appointment. There is no carrier, no
 * label, no tracking — a deliberate simplification this codebase's DTS
 * ancestor never had, and the reason this file is a third of its old size.
 */

/**
 * One type. The column and the constant survive the mail-in/pickup removal
 * because "office" is load-bearing in the schema and the walk-in flag hangs
 * off it — and because a second type (say, we start travelling to bulk
 * sellers) slots back in as data instead of a migration of meaning.
 */
export const ORDER_TYPES = ["office"];

/**
 * Somebody turned up unannounced and sold us devices over the counter.
 *
 * A walk-in is a MEETUP THAT SKIPPED THE APPOINTMENT — same place, same
 * in-person handover — which is why it shares the `office` type rather than
 * being a second one. The difference is tense: a meetup is a promise about
 * the future, a walk-in is a record of something that already happened.
 * Everything that treats the two differently (no confirmation text, no
 * calendar entry) follows from that one sentence.
 *
 * Tested against the flag AND the type, so a walkIn flag that somehow landed
 * on a malformed row can't quietly claim the exemptions.
 */
export function isWalkIn(order) {
  return order?.type === "office" && order?.walkIn === true;
}

/**
 * How the devices reached us, in one word, for any surface that lists orders
 * side by side.
 *
 * Takes the ORDER, not the type string, because "Meetup" and "Walk-in" share
 * a type and only the flag separates them — and calling somebody's
 * unannounced visit a meetup is the app stating something that never
 * happened.
 */
export function orderTypeLabel(order) {
  if (isWalkIn(order)) return "Walk-in";
  return "Meetup";
}

/** The verb for marking an order's devices handed over, from our side. */
export function receivedActionLabel(order) {
  return "Mark bought";
}

/**
 * Whether reaching a stage is worth texting the customer about.
 *
 * Never, for received and paid: every handover is in person, so a real
 * person just said "got it" or handed over the cash out loud. Texting them
 * anyway is the app talking for the sake of it, thirty seconds after a human
 * said the same thing. The payout is still RECORDED — paidAmount, method,
 * and an activity line naming the figure — which is the record that matters.
 * Appointment confirmations and reminders are separate sends with their own
 * rules (lib/appointment-sweep.js).
 */
export function announcesStage(order, status) {
  if (status === "received" || status === "paid") return false;
  return true;
}

/** Over, with no money moved. Terminal, like paid, and meaning the opposite. */
export function isCancelled(order) {
  return order?.status === "cancelled";
}

/**
 * An admin struck this order from the books.
 *
 * The record is KEPT (name, phone, items, payout, trail) but the order no
 * longer counts for anything: its lots were removed from inventory and its
 * payout is out of every money figure. Under the hood the status is
 * `cancelled` — that is the one state every money reader already excludes,
 * and reusing it means a deleted order can never be re-counted by a reader
 * nobody taught about deletion. `deletedAt` is what distinguishes it from an
 * ordinary cancel for the people reading the screen, via displayStage().
 */
export function isDeleted(order) {
  return Boolean(order?.deletedAt);
}

/**
 * Whether an admin may still delete this order. Once is enough; everything
 * else — awaiting, bought, paid, even cancelled — is deletable, and the
 * ACTION refuses the one thing this predicate can't see: devices from the
 * order that are already on an invoice or sold.
 */
export function canDeleteOrder(order) {
  return Boolean(order) && !isDeleted(order);
}

/**
 * Still live work — not paid, not cancelled.
 *
 * BOTH terminal states have to be excluded, and forgetting the second one is
 * the easy mistake: "open" was once written as `status !== "paid"` in five
 * separate places in the ancestor app, so a cancelled order still counted as
 * open on the dashboard, in a customer's order count, and — worst — in the
 * duplicate check at intake. An order somebody deliberately ended should
 * never block or inflate anything.
 */
export function isOpen(order) {
  return order?.status !== "paid" && order?.status !== "cancelled";
}

/**
 * Whether the order can still be changed.
 *
 * Editing is for fixing what was typed, not for rewriting history. Once the
 * devices have been bought or paid for, the row is a record of what happened
 * and the corrections that remain are specific and separately logged — the
 * payout amount, and nothing else.
 */
export function isEditable(order) {
  return order?.status === "awaiting";
}

/** Whether cancelling is still meaningful. Paid orders are already finished. */
export function canCancel(order) {
  return order?.status === "awaiting" || order?.status === "received";
}

/**
 * The one status each status may advance to. The ladder is
 * awaiting -> received -> paid; paid and cancelled are terminal and appear
 * nowhere on the left.
 */
const STATUS_FORWARD = { awaiting: "received", received: "paid" };

/**
 * Whether nextStatus is the legal next rung for this order.
 *
 * advanceOrderStatus guards the WRITE against a concurrent change, but a
 * compare-and-swap keyed on the status just read proves only that nobody
 * else moved it - not that the move itself is allowed. Without this, a stale
 * tab whose buttons rendered while the order was awaiting can post
 * paid->received and revive a finished order: back into the payout queue and
 * paid a second time. Cancellation and the no-show outcome are their own
 * actions and do not pass through here.
 */
export function canAdvanceTo(order, nextStatus) {
  return STATUS_FORWARD[order?.status] === nextStatus;
}

/**
 * A meetup that produced no devices.
 *
 * These leave the order AWAITING on purpose: an appointment nobody showed up
 * to is an appointment to try again, not a finished order. What they change
 * is the record — so nobody has to mark a no-show "bought", which would be
 * the app stating something that never happened.
 */
export const STOP_OUTCOMES = [
  // `announces`: whether reporting this outcome texts the customer. A
  // no-show gets a sorry-we-missed-you with a rebook invitation. "Customer
  // cancelled" stays silent on purpose: they said it to a person seconds
  // ago, and an instant automated reply reads as the company not listening —
  // the one outcome where the human already had the last word.
  { key: "no_show", label: "Didn't show up", announces: true },
  { key: "customer_cancelled", label: "Customer cancelled", announces: false },
];

export function stopOutcomeLabel(key) {
  return STOP_OUTCOMES.find((o) => o.key === key)?.label || key;
}

/** Whether reporting this outcome sends the customer a rebook text. */
export function stopOutcomeAnnounces(key) {
  return Boolean(STOP_OUTCOMES.find((o) => o.key === key)?.announces);
}

/** An order whose last meetup failed and which nobody has picked back up. */
export function needsAnotherAttempt(order) {
  return Boolean(order?.stopOutcome) && order?.status === "awaiting";
}

/**
 * The activity marker for the once-only "still want to sell?" follow-up.
 * An activity line rather than a column: one fact, on a handful of orders,
 * that belongs in the audit trail anyway.
 */
export const FAILED_STOP_FOLLOW_UP_ACTION = "Follow-up sent - asked if they still want to sell";

/** When the follow-up was sent, or null. Latest wins. */
export function stopFollowUpSentAt(order) {
  const hits = (order?.activity || []).filter(
    (e) => e?.action === FAILED_STOP_FOLLOW_UP_ACTION && e?.at,
  );
  return hits.length ? Math.max(...hits.map((e) => Number(e.at))) : null;
}

/**
 * Due the once-only follow-up: a no-show that texted a rebook invitation,
 * FAILED_STOP_FOLLOW_UP_DAYS ago or more, with no reply handled since.
 *
 * Only the announcing outcomes — a cancellation was settled in person. The
 * marker is compared against stopOutcomeAt, not just for existence, so a
 * SECOND no-show after an old follow-up starts a fresh clock. A pickupDate
 * today or later means someone already rebooked them — nothing to chase.
 * The has-the-customer-replied check is the sweep's job; this rule owns the
 * calendar arithmetic.
 */
export function needsStopFollowUp(order, now = Date.now()) {
  if (!needsAnotherAttempt(order)) return false;
  if (!stopOutcomeAnnounces(order.stopOutcome)) return false;
  const failedAt = Number(order.stopOutcomeAt) || null;
  if (!failedAt) return false;
  if (now - failedAt < FAILED_STOP_FOLLOW_UP_DAYS * 86400000) return false;
  const sent = stopFollowUpSentAt(order);
  if (sent !== null && sent >= failedAt) return false;
  if (order.pickupDate && order.pickupDate >= dayKey(new Date(now))) return false;
  return true;
}

/**
 * The activity line the sweep writes when the Google review ask goes out.
 * A constant read back by string match: one fact, on the handful of
 * first-payout orders, that belongs in the audit trail anyway.
 */
export const REVIEW_ASK_ACTION = "Review request sent";

/** When the review ask went out for this order, or null. */
export function reviewAskedAt(order) {
  const hits = (order?.activity || []).filter((e) => e?.action === REVIEW_ASK_ACTION && e?.at);
  return hits.length ? Math.max(...hits.map((e) => Number(e.at))) : null;
}

/**
 * Due the once-ever Google review ask: paid, REVIEW_ASK_AFTER_BUSINESS_DAYS
 * business days ago or more (0 - immediately), not already asked, and not so
 * long ago that the ask reads as odd — REVIEW_ASK_WINDOW_DAYS is what stops
 * the first sweep after this ships from texting everyone ever paid.
 *
 * OFF while GOOGLE_REVIEW_URL is empty: CLT Buyback doesn't have its listing
 * link in the code yet, and a review ask with no link is spam with homework.
 *
 * This rule owns the calendar arithmetic for ONE order. "Is this their FIRST
 * payout" needs the phone's other orders, and "have they texted us since"
 * needs the message thread — both are the sweep's job, same split as
 * needsStopFollowUp above.
 *
 * PAUSE is respected (remindersCancelledAt): a review ask is exactly the
 * kind of automated message that keyword exists to stop.
 */
export function needsReviewAsk(order, now = Date.now()) {
  if (!GOOGLE_REVIEW_URL) return false;
  if (order?.status !== "paid" || !order?.phone) return false;
  if (order.remindersCancelledAt) return false;
  if (reviewAskedAt(order) !== null) return false;
  const paidAt = payoutAt(order);
  if (!paidAt) return false;
  if (now - paidAt > REVIEW_ASK_WINDOW_DAYS * 86400000) return false;
  return businessDaysBetween(paidAt, now) >= REVIEW_ASK_AFTER_BUSINESS_DAYS;
}

/**
 * The stage to HIGHLIGHT. One derived stage exists: "deleted", which the
 * database stores as status `cancelled` plus a `deleted_at` stamp (see
 * isDeleted). Every surface branches through here rather than reading
 * order.status directly, which is exactly why adding that stage touched this
 * function and the badge palette, and nothing else.
 *
 * @param {import('./types').Order} [order]
 * @returns {string} a stage key from stagesForOrder()
 */
export function displayStage(order) {
  if (isDeleted(order)) return "deleted";
  return order?.status;
}

/**
 * The stages that apply to a given order.
 * @param {import('./types').Order} [order]
 */
export function stagesForOrder(order) {
  // Deleted before cancelled: a deleted order IS status cancelled underneath,
  // and the stepper should say which of the two somebody did to it.
  if (isDeleted(order)) {
    return [
      ...STAGES.filter((s) => s.key === "awaiting").map((s) => ({ ...s, label: "Created" })),
      { key: "deleted", label: "Deleted", icon: STAGES[STAGES.length - 1].icon },
    ];
  }
  // A cancelled order left the pipeline; showing it part-way along one
  // implies it is still moving. The last step becomes what actually happened.
  if (isCancelled(order)) {
    return [
      ...STAGES.filter((s) => s.key === "awaiting").map((s) => ({ ...s, label: "Created" })),
      { key: "cancelled", label: "Cancelled", icon: STAGES[STAGES.length - 1].icon },
    ];
  }
  // A walk-in was never awaited; its first step records how it arrived.
  if (isWalkIn(order)) {
    return STAGES.map((s) => (s.key === "awaiting" ? { ...s, label: "Walked In" } : s));
  }
  return STAGES;
}

/**
 * The label for a status, in this order's own language. Derived from
 * stagesForOrder so the badge and the stepper can never disagree.
 *
 * @param {string} stageOrStatus
 * @param {{type?: string}} [order]
 */
export function statusLabel(stageOrStatus, order) {
  const stage = stagesForOrder(order).find((s) => s.key === stageOrStatus);
  if (stage) return stage.label;
  // A mislabeled row shouldn't render a raw enum at a customer-facing moment.
  return STAGES.find((s) => s.key === stageOrStatus)?.label || stageOrStatus;
}

/** A meetup whose scheduled date has already passed. */
export function isOverdueLocal(s, now = Date.now()) {
  if (s?.status !== "awaiting" || !s?.pickupDate) return false;
  // Compare calendar DAYS in the business timezone, not Date instants. Both
  // sides are YYYY-MM-DD and dayKey is TZ-pinned, so a lexicographic compare
  // is the same as a chronological one and gives the same answer on a UTC
  // server as on a staffer's Eastern browser.
  return s.pickupDate < dayKey(new Date(now));
}

/** Whether an order should be surfaced for staff follow-up. */
export function needsFollowUp(s) {
  return isOverdueLocal(s);
}
