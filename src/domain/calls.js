/**
 * How a call reads to a person.
 *
 * Twilio's status vocabulary is about what the telephone network did; this is
 * about what happened to the business. "no-answer" is a missed call worth
 * following up; "canceled" is the customer hanging up while it rang, which is
 * the same thing from where we sit and is deliberately grouped with it.
 */

import { menuOptionByKey, TOLD_TO_TEXT } from "./phone-menu";

/** Calls that are happening right now. */
export const LIVE_STATUSES = ["queued", "ringing", "in-progress"];

export function isLive(call) {
  return LIVE_STATUSES.includes(call?.status);
}

/**
 * Hung up inside the phone menu: it answered, and the call ended before a key
 * was pressed or the silence timeout rang it through.
 *
 * The same trap as the voicemail greeting below, one step earlier. The menu
 * is TwiML answering the call, so Twilio closes it as "completed" - and
 * before the menu existed this caller would have been a plain "canceled".
 * `menuChoice` is written the moment the call leaves the menu (a real key OR
 * the no-key ring-through), so null on an ended call can only mean they
 * never got past the greeting.
 */
export function leftAtMenu(call) {
  return Boolean(call?.menuAt) && !call?.menuChoice && !isLive(call);
}

/**
 * Got the busy message and the text instead of a ringing phone - "message"
 * mode, where nobody picks up BY DESIGN. Still a missed call: the caller
 * spoke to no one, and the text they were sent is an invitation, not a
 * conversation. Until they reply or somebody reaches out, they are a lead
 * sitting in the log - exactly what the follow-up queue is for.
 */
export function toldToText(call) {
  return call?.menuChoice === TOLD_TO_TEXT;
}

/**
 * The menu itself was the answer: they pressed the info key, heard the
 * address and hours, and did not ask for a person. Nobody owes them a call.
 */
export function selfServed(call) {
  return menuOptionByKey(call?.menuChoice)?.does === "info";
}

/** A call nobody took. The ones worth a callback. */
export function isMissed(call) {
  if (call?.direction !== "inbound") return false;
  if (["no-answer", "canceled", "busy", "failed"].includes(call?.status)) return true;
  if (leftAtMenu(call) || toldToText(call)) return true;
  // Rolled to the voicemail greeting: Twilio closes the parent leg as
  // "completed" because our TwiML answered it — but no PERSON did. Without
  // this, a caller who hung up at the greeting was logged "Answered" and never
  // reached the follow-up queue: a lead lost by bookkeeping. to_voicemail is
  // only ever written when the dial went unanswered, so it can't mark a call a
  // human actually took.
  return Boolean(call?.toVoicemail);
}

/** Whether this call left a message nobody has played yet. */
export function hasVoicemail(call) {
  return Boolean(call?.voicemailUrl);
}

/**
 * A call still waiting on somebody: missed, and nobody has marked it done.
 *
 * This is what turns the Missed list from an archive into a worklist. A caller
 * who left a voicemail counts even if the status came back "completed" — they
 * reached the recorder, not a person, so somebody still owes them a call.
 */
export function needsFollowUp(call) {
  if (call?.direction !== "inbound" || call?.handledAt) return false;
  return isMissed(call) || hasVoicemail(call);
}

/** One word for what happened, in the language of the business. */
export function callOutcome(call) {
  if (isLive(call)) return call.status === "in-progress" ? "On call" : "Ringing";
  if (isMissed(call)) {
    if (call.status === "busy") return "Busy";
    // The distinction staff act on: a message to play back, or a caller who
    // gave up at the greeting and is only reachable by calling back.
    if (hasVoicemail(call)) return "Voicemail";
    if (toldToText(call)) return "Told to text";
    if (leftAtMenu(call)) return "Hung up at menu";
    return call?.toVoicemail ? "Missed (no message)" : "Missed";
  }
  if (call?.status === "completed") {
    if (call.direction === "outbound") return "Called";
    // "Answered" would claim a person picked up; the menu did.
    return selfServed(call) ? "Heard address & hours" : "Answered";
  }
  return call?.status || "Unknown";
}

/** "4:07" — duration as a person says it, not as seconds. */
export function formatDuration(seconds) {
  if (!(seconds > 0)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Filters offered on the call log. */
export const CALL_FILTERS = [
  { key: "all", label: "All" },
  // First on purpose: it is the only filter that shrinks as the work gets
  // done, which makes it the one worth opening the page for.
  { key: "follow_up", label: "Needs follow-up" },
  { key: "voicemail", label: "Voicemail" },
  { key: "missed", label: "Missed" },
  { key: "inbound", label: "Inbound" },
  { key: "outbound", label: "Outbound" },
];

export function matchesFilter(call, filter) {
  if (filter === "follow_up") return needsFollowUp(call);
  if (filter === "voicemail") return hasVoicemail(call);
  if (filter === "missed") return isMissed(call);
  if (filter === "inbound" || filter === "outbound") return call.direction === filter;
  return true;
}
