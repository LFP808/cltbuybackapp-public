import { twiml, baseUrl, webhookUrl, xml } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { upsertCall } from "@/lib/repositories/calls";
import { textMissedCaller } from "@/lib/missed-call-text";
import { normPhone } from "@/domain/format";

/**
 * The forwarded call wasn't answered (no-answer / busy / failed).
 *
 * Twilio POSTs here as the <Dial action="…"> once the forward leg ends. Two
 * things happen to a caller nobody picked up for, because a missed call from a
 * stranger IS this business's lead list:
 *
 *   1. THEY GET TO LEAVE A MESSAGE. This route used to play a goodbye and hang
 *      up, throwing away the only thing the caller had to say.
 *   2. THEY GET A TEXT, immediately, inviting a reply. Texting is the channel
 *      we answer well, and "we'll call you back eventually" loses to the next
 *      company on their list.
 *
 * The text is claimed in the database before sending so a retried webhook
 * cannot text the same person twice (lib/missed-call-text.js, shared with
 * the don't-ring mode of /api/voice/incoming).
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/voicemail"),
  );
  if (forbidden) return forbidden;

  // Answered — the <Dial> is over and there is nothing left to say.
  if (params.DialCallStatus === "completed") return twiml("");

  const base = baseUrl(request);
  const callSid = params.CallSid;
  const from = normPhone(params.From || "");

  // Mark it here rather than waiting for the recording: a caller who hangs up
  // during the greeting still went to voicemail, and the log should say so.
  try {
    await upsertCall(callSid, { to_voicemail: true });
  } catch (err) {
    console.error("Voicemail flag write failed:", err?.message || err);
  }

  await textMissedCaller(callSid, from);

  return twiml(
    `<Say>Sorry, we can't come to the phone right now. Leave a message after the tone and we'll call you back. You can also just reply to the text we've sent you.</Say>` +
      `<Record maxLength="120" playBeep="true" trim="trim-silence"` +
      ` recordingStatusCallback="${xml(`${base}/api/voice/voicemail-recording`)}"` +
      ` recordingStatusCallbackEvent="completed" />` +
      `<Say>We didn't get a message. Goodbye.</Say><Hangup/>`,
  );
}
