import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTranscriptText } from "@/lib/twilio/intelligence";

/**
 * Voice Intelligence webhook — a transcript has finished processing.
 *
 * Configure this as the service's status callback in the Twilio console:
 *   https://<production-host>/api/voice/transcript
 *
 * The callback carries only ids, so the text is fetched back over the API and
 * flattened onto the call row. Matched to the call by RECORDING sid: the
 * transcript knows which recording it came from, and the recording callback
 * already wrote that sid against the call.
 *
 * Not signature-validated the same way as the Voice webhooks — Voice
 * Intelligence signs with the same scheme, but the body here is JSON rather
 * than form-encoded, so validateTwilioSignature does not apply. The route
 * writes nothing an attacker gains from and reveals nothing in its response;
 * if that changes, verify before writing.
 */
export async function POST(request) {
  let payload = {};
  try {
    payload = await request.json();
  } catch {
    // Twilio has posted form-encoded here in the past; accept both.
    const form = await request.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) payload[k] = String(v);
  }

  const transcriptSid = payload.transcript_sid || payload.TranscriptSid || payload.sid;
  const recordingSid =
    payload.source_sid || payload.SourceSid || payload.recording_sid || payload.RecordingSid;
  const status = payload.status || payload.Status;

  if (!transcriptSid || !recordingSid) return new Response(null, { status: 204 });

  const supabase = createAdminClient();

  if (status && status !== "completed") {
    if (status === "failed") {
      await supabase
        .from("calls")
        .update({ transcript_status: "failed" })
        .eq("recording_sid", recordingSid);
    }
    return new Response(null, { status: 204 });
  }

  try {
    const text = await fetchTranscriptText(transcriptSid);
    await supabase
      .from("calls")
      .update({ transcript: text, transcript_status: text ? "ready" : "failed" })
      .eq("recording_sid", recordingSid);
  } catch (err) {
    console.error("Transcript store failed:", err?.message || err);
    await supabase
      .from("calls")
      .update({ transcript_status: "failed" })
      .eq("recording_sid", recordingSid)
      .then(() => {})
      .catch(() => {});
  }

  return new Response(null, { status: 204 });
}
