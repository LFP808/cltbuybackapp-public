import { createAdminClient } from "@/lib/supabase/admin";
import { rowToOrder, orderPatchToRow } from "@/lib/mappers";
import { STOP_OUTCOMES } from "@/domain/orders";

/**
 * Sweep bookkeeping — the automated texts nobody presses a button for.
 *
 * Two schedulers read this file: the CRM sweep (/api/reminders — the missed-
 * meetup follow-up and the review ask) and the appointment sweep
 * (/api/appointments). These helpers exist so that each once-only text is
 * recorded exactly once and is never sent to a customer who asked us to stop.
 *
 * ADMIN CLIENT THROUGHOUT, and that is load-bearing: the sweeps run from a
 * scheduler with no session, and every operational policy requires an active
 * staff profile. A session client would read zero rows here and each sweep
 * would report a quiet day forever.
 */

/**
 * Missed meetups that may be due the once-only "still want to sell?" text.
 * The database narrows to the cheap, indexable facts — still awaiting, an
 * announcing outcome, old enough, not opted out — and the sweep applies the
 * judgement calls (already sent, replied since, rebooked) where the activity
 * trail and the message thread live.
 *
 * @param {number} cutoff epoch ms — only meetups that failed at or before this
 */
export async function listStopFollowUpCandidates(cutoff, limit = 200) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "awaiting")
    // The domain's list, not a copy of it — the announcing outcomes and the
    // followed-up outcomes are the same set, and must stay one set.
    .in(
      "stop_outcome",
      STOP_OUTCOMES.filter((o) => o.announces).map((o) => o.key),
    )
    .is("reminders_cancelled_at", null)
    .lte("stop_outcome_at", new Date(cutoff).toISOString())
    // Oldest first: if a run is ever truncated, the people waiting longest
    // are the ones who got their text.
    .order("stop_outcome_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * Recently paid orders that might be due the once-ever review ask.
 *
 * The database narrows to the cheap facts: paid, has a phone, not opted out
 * of automated texts, and paid inside the ask window — `from` is the caller's
 * REVIEW_ASK_WINDOW_DAYS cutoff, which is also what keeps this query small
 * forever (it can never return more than a week of payouts). Whether each is
 * DUE (business-day arithmetic, the once-ever marker), whether it is the
 * phone's FIRST payout, and whether the customer has replied since are the
 * sweep's judgement calls.
 *
 * @param {number} from epoch ms — only payouts at or after this
 */
export async function listReviewAskCandidates(from, limit = 200) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "paid")
    .not("phone", "is", null)
    .is("reminders_cancelled_at", null)
    .gte("paid_at", new Date(from).toISOString())
    // Oldest first, same rationale as every other lane: if a run is ever
    // truncated, the people waiting longest get their text.
    .order("paid_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * Whether this phone was paid out on some OTHER order before `beforeMs`.
 *
 * The "first payout" half of the review ask that one order cannot answer
 * about itself. Null paid_at rows count by created_at — a customer paid
 * before the paid_at column existed is still a repeat customer, and the ask
 * is for first-timers only.
 */
export async function hasEarlierPayout(phone, excludeId, beforeMs) {
  const supabase = createAdminClient();
  const iso = new Date(beforeMs).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .eq("phone", phone)
    .neq("id", excludeId)
    .or(`paid_at.lt.${iso},and(paid_at.is.null,created_at.lt.${iso})`)
    .limit(1);
  // A FAILED READ COUNTS AS AN EARLIER PAYOUT: the safe answer when we cannot
  // tell is the one that sends nothing, same rule as hasRepliedSince below.
  if (error) {
    console.error("Earlier-payout check failed:", error?.message || error);
    return true;
  }
  return (data ?? []).length > 0;
}

/**
 * Open meetups dated today or tomorrow (business-local days, computed by the
 * caller) — the appointment sweep's working set. The database narrows on the
 * indexable facts; which of the three reminders each order is due, if any,
 * is domain/appointments.js's call against the activity trail.
 *
 * @param {string[]} days YYYY-MM-DD keys, e.g. [today, tomorrow]
 */
export async function listAppointmentCandidates(days, limit = 500) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "awaiting")
    .eq("type", "office")
    .in("pickup_date", days)
    .is("reminders_cancelled_at", null)
    .is("stop_outcome", null)
    .not("phone", "is", null)
    .order("pickup_date", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}

/**
 * Apply a patch to an order from a job that has no session.
 *
 * repositories/orders.js#updateOrder goes through the session client, which is
 * right for a staff action and useless here: the sweeps run from a scheduler,
 * and a session-less request reads and writes nothing. The compare-and-swap on
 * status is what makes it safe to run beside real people — a customer who
 * shows up between the read and this write keeps the arrival and loses the
 * automated patch, rather than the other way round.
 *
 * @returns {Promise<boolean>} whether the row was still in `expectedStatus`
 */
export async function patchOrderAsSystem(id, patch, expectedStatus) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .update(orderPatchToRow(patch))
    .eq("id", id)
    .eq("status", expectedStatus)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Whether this customer has said anything to us since a given moment.
 *
 * Every automated text makes an implicit promise — "reply here and a person
 * answers" — and this is what keeps it: nothing in the sweeps templates over
 * a customer who has already spoken.
 *
 * Inbound only, and by phone rather than by order: a customer answering a
 * text is replying to us, whichever order the thread is filed against, and
 * they should not have to quote a reference number to be heard.
 */
export async function hasRepliedSince(phone, since) {
  if (!phone || !since) return false;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "inbound")
    .gt("created_at", new Date(since).toISOString())
    .limit(1);

  // A FAILED READ COUNTS AS A REPLY. This decides whether to text someone who
  // may be mid-conversation with a person, so the safe answer when we cannot
  // tell is the one that does nothing and leaves it for a human.
  if (error) {
    console.error(`Could not check replies for ${phone}:`, error.message || error);
    return true;
  }
  return (data ?? []).length > 0;
}

/**
 * Stop automated texts for every open order belonging to a phone number —
 * the PAUSE keyword's write path. Gates the appointment reminders, the
 * missed-meetup follow-up and the review ask; ordinary human messages are
 * untouched (that is STOP's job, and the carrier's).
 *
 * Scoped to open orders on purpose: "stop reminding me" is about the meetup
 * they haven't made, not a standing instruction. A new order months from now
 * starts with a clean slate.
 *
 * @returns {Promise<import('@/domain/types').Order[]>} the orders stopped
 */
export async function cancelRemindersForPhone(phone, now = Date.now()) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ reminders_cancelled_at: new Date(now).toISOString() })
    .eq("phone", phone)
    .eq("status", "awaiting")
    .is("reminders_cancelled_at", null)
    .select("*");

  if (error) throw error;
  return (data ?? []).map(rowToOrder);
}
