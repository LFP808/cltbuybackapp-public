import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToCall } from "@/lib/mappers";
import { normPhone } from "@/domain/format";

/**
 * Reads and writes for the call log.
 *
 * Two clients on purpose, the same split messages uses:
 *
 *   - reads go through the SESSION client, so row-level security applies and a
 *     signed-out request sees nothing.
 *   - webhook writes go through the ADMIN client, because Twilio arrives with
 *     no session at all. Those routes validate Twilio's signature instead,
 *     which is the only credential a webhook can actually present.
 */

/** The most recent calls, newest first. */
export async function listCalls(limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToCall);
}

/** One customer's calls, newest first — for the customer timeline. */
export async function listCallsByPhone(phone) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("phone", normPhone(phone))
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToCall);
}

/**
 * Create or update a call from a Twilio webhook.
 *
 * Upsert on call_sid rather than insert: Twilio reports the same call several
 * times over its life, and each report has to land on the row the previous one
 * made. Which report arrives first is not guaranteed, so this must work in any
 * order - hence the merge below rather than a plain overwrite.
 *
 * @param {string} callSid
 * @param {object} patch snake_case column values
 */
export async function upsertCall(callSid, patch) {
  const supabase = createAdminClient();

  // Only overwrite what this report actually knows. A late-arriving "ringing"
  // must not blank the recording URL that "completed" already set, and
  // undefined keys would do exactly that on an upsert.
  const fields = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined && v !== null),
  );

  const { data, error } = await supabase
    .from("calls")
    .upsert({ call_sid: callSid, ...fields }, { onConflict: "call_sid" })
    .select()
    .single();
  if (error) throw error;
  return rowToCall(data);
}

/**
 * Record who picked up.
 *
 * Deliberately first-answer-wins: every device rings at once, so two legs can
 * report answering within the same second and the second one is a race, not a
 * correction. The guard is in the filter, not in application code, so it holds
 * even when the two reports are handled by different server instances.
 */
export async function claimCall(callSid, { staffId, staffName }) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calls")
    .update({ answered_by: staffId, answered_name: staffName, status: "in-progress" })
    .eq("call_sid", callSid)
    .is("answered_by", null)
    .select();
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Look up a call by its Twilio sid, or null. Admin client: used by webhooks. */
export async function findCallBySid(callSid) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .eq("call_sid", callSid)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCall(data) : null;
}

/**
 * Claim the right to send the "sorry we missed you" text for a call.
 *
 * Twilio retries webhooks, and two deliveries of the same action would
 * otherwise text the caller twice. The guard is the `is null` filter, settled
 * in the database, so it holds across server instances.
 *
 * @returns {Promise<boolean>} true for the one caller that may send
 */
export async function claimMissedText(callSid) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calls")
    .update({ missed_texted_at: new Date().toISOString() })
    .eq("call_sid", callSid)
    .is("missed_texted_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Mark a call followed up, or reopen it.
 *
 * Records WHO, not just that it happened: this list is worked by more than one
 * person and "Ana called them back" is the useful version. Session client —
 * this is a staff action, unlike the webhook writes above.
 */
export async function setCallHandled(id, { handled, staffName }) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("calls")
    .update({
      handled_at: handled ? new Date().toISOString() : null,
      handled_by: handled ? staffName : null,
    })
    .eq("id", id);
  if (error) throw error;
}

// The two halves of "somebody is owed a call", as PostgREST or-clauses.
// Unanswered by the network's account, rolled to the recorder, or left a
// message:
const OWED_UNANSWERED =
  "status.in.(no-answer,busy,failed,canceled),to_voicemail.is.true,voicemail_url.not.is.null";
// ...or never got a person from the auto-answer: sent away with the busy
// message (domain/calls.js#toldToText), or hung up inside the phone menu
// (#leftAtMenu).
const OWED_AUTO_ANSWERED =
  "menu_choice.eq.told_to_text," +
  "and(menu_at.not.is.null,menu_choice.is.null,status.not.in.(queued,ringing,in-progress))";

/**
 * Inbound calls nobody has closed out — the follow-up queue count.
 *
 * The SQL twin of domain/calls.js#needsFollowUp, and it has to stay one: the
 * sidebar badge is this number and the Calls page's "Needs follow-up" filter
 * is that function. It used to count Twilio's unanswered statuses alone,
 * which was already short (a call that reached the voicemail greeting closes
 * as "completed") and would have gone dead once calls were auto-answered
 * (the busy message, the phone menu): TwiML picks up EVERY call, so almost
 * nothing ends "no-answer" any more.
 *
 * The auto-answer clause is tried first and dropped on error: on a database
 * that hasn't had migration 0009 run, naming those columns fails the whole
 * query, and a badge stuck at zero is worse than one that can't see them.
 */
export async function countUnhandledCalls() {
  const supabase = await createClient();
  const owed = (clauses) =>
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("direction", "inbound")
      .is("handled_at", null)
      .or(clauses);

  let { count, error } = await owed(`${OWED_UNANSWERED},${OWED_AUTO_ANSWERED}`);
  if (error) ({ count, error } = await owed(OWED_UNANSWERED));
  if (error) throw error;
  return count ?? 0;
}

/** Calls still ringing or connected — what the live log highlights. */
export async function countActiveCalls() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "ringing", "in-progress"]);
  if (error) throw error;
  return count ?? 0;
}
