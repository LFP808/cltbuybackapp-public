import { webhookUrl } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { upsertCall } from "@/lib/repositories/calls";

/**
 * A voicemail finished recording.
 *
 * Separate from /api/voice/recording, which handles the recording of a call
 * somebody ANSWERED. Same webhook shape, different meaning: that one is a
 * conversation for the archive, this one is a message nobody has heard yet and
 * belongs to the follow-up queue.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/voicemail-recording"),
  );
  if (forbidden) return forbidden;

  const callSid = params.CallSid;
  // .mp3 rather than the bare URL: the bare one needs auth, this one plays in
  // an <audio> tag, which is all the log needs it for.
  const url = params.RecordingUrl ? `${params.RecordingUrl}.mp3` : null;
  const secs = Number(params.RecordingDuration);

  try {
    await upsertCall(callSid, {
      voicemail_sid: params.RecordingSid,
      voicemail_url: url,
      voicemail_secs: Number.isFinite(secs) ? secs : null,
      to_voicemail: true,
    });
  } catch (err) {
    console.error("Voicemail write failed:", err?.message || err);
  }

  return new Response(null, { status: 204 });
}
