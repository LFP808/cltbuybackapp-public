import { webhookUrl } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { upsertCall, findCallBySid } from "@/lib/repositories/calls";
import { isTranscriptionConfigured, requestTranscript } from "@/lib/twilio/intelligence";

/**
 * The call recording is ready.
 *
 * Stores the audio URL on the call, then asks Voice Intelligence for a
 * transcript. The transcript arrives later at /api/voice/transcript, so this
 * marks it "pending" — a call showing "transcribing…" is understandable, a
 * call showing nothing looks broken.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/recording"),
  );
  if (forbidden) return forbidden;

  // On a <Dial recordingStatusCallback>, CallSid is the parent (customer) call.
  const callSid = params.CallSid;
  const recordingSid = params.RecordingSid;
  // .mp3 rather than the bare URL: the bare one needs auth, this one plays in
  // an <audio> tag, which is the only thing the log needs it for.
  const recordingUrl = params.RecordingUrl ? `${params.RecordingUrl}.mp3` : null;

  const wantsTranscript = isTranscriptionConfigured();

  try {
    await upsertCall(callSid, {
      recording_sid: recordingSid,
      recording_url: recordingUrl,
      transcript_status: wantsTranscript ? "pending" : "skipped",
    });
  } catch (err) {
    console.error("Recording write failed:", err?.message || err);
  }

  if (wantsTranscript) {
    try {
      const call = await findCallBySid(callSid);
      await requestTranscript(recordingSid, call?.fromNumber || "");
    } catch (err) {
      console.error("Transcript request failed:", err?.message || err);
      // Say so on the call rather than leaving it pending for ever.
      await upsertCall(callSid, { transcript_status: "failed" }).catch(() => {});
    }
  }

  return new Response(null, { status: 204 });
}
