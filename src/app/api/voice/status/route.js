import { voiceConfig, webhookUrl } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { upsertCall } from "@/lib/repositories/calls";
import { normPhone } from "@/domain/format";

/**
 * Twilio call status callback — the call's own lifecycle.
 *
 * Set as the number's "Call status changes" callback, and passed on outbound
 * calls placed from the browser. Fires on ringing, answered and completed.
 *
 * This tells us the call ENDED and for how long. Which assistant picked it up
 * comes from the per-leg callback in /api/voice/leg, because a call-level
 * event only knows that somebody answered.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/status"),
  );
  if (forbidden) return forbidden;

  const status = params.CallStatus || "unknown";
  const outbound = String(params.Direction || "").startsWith("outbound");
  // Whichever end isn't us is the customer.
  const customer = outbound ? params.To : params.From;

  const ended = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);
  const duration = Number(params.CallDuration || params.DialCallDuration || 0);

  // KEY ON THE PARENT LEG WHEN THERE IS ONE. An outbound call is placed from the
  // browser as a parent client leg, and /api/voice/outbound creates the row
  // under that parent's CallSid. But THIS callback rides the child <Number> leg
  // dialed to the customer, whose events carry their own CallSid and the
  // parent's as ParentCallSid. Upserting on the child's CallSid inserted a
  // SECOND row for every outbound call - holding the duration - while the parent
  // row (which owns answered_by, the recording and the transcript) sat at
  // 'ringing' forever, pulsing green in the log and inflating countActiveCalls.
  // Collapsing onto ParentCallSid updates the one real row. Inbound has no
  // parent here and falls through to its own CallSid, exactly as before.
  const callSid = params.ParentCallSid || params.CallSid;

  // The call-through's FIRST leg dials the owner's own cell — its far end is
  // not the customer, and the customer's number isn't in these events at all
  // (the bridge dials it on a child leg, whose events carry it correctly).
  // Writing it here would re-file the whole call under the owner's number, so
  // the forwarding cell never lands in `phone`.
  const digits = normPhone(customer);
  const ownCell = normPhone(voiceConfig().forwardTo);

  try {
    await upsertCall(callSid, {
      direction: outbound ? "outbound" : "inbound",
      from_number: params.From,
      to_number: params.To,
      phone: digits && digits !== ownCell ? digits : undefined,
      status,
      ended_at: ended ? new Date().toISOString() : undefined,
      // 0 is a real answer ("nobody spoke") but also Twilio's default for an
      // event that simply doesn't carry a duration, so only trust a positive.
      duration_secs: duration > 0 ? duration : undefined,
    });
  } catch (err) {
    console.error("Call status write failed:", err?.message || err);
  }

  // Twilio ignores the body of a status callback; 204 keeps it quiet.
  return new Response(null, { status: 204 });
}
