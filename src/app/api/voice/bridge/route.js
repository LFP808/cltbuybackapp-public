import { voiceConfig, baseUrl, webhookUrl, twiml, xml } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { customerNameByPhone } from "@/lib/repositories/customer-name";
import { normPhone } from "@/domain/format";

/**
 * TwiML for the admin call-through's SECOND leg.
 *
 * callCustomerAction places a REST call to the owner's cell; when he answers,
 * Twilio fetches this URL to learn what happens next: announce who is being
 * connected, then dial the customer showing the BUSINESS number — the customer
 * sees the same caller ID they text with, never a personal cell.
 *
 * The customer's number rides the query string, which the Twilio signature
 * covers (same as /api/voice/leg), so it cannot be swapped in transit. It is
 * still re-validated to ten digits here: the action already checked, but a
 * webhook that trusts its own query string is one refactor away from dialling
 * whatever it is handed.
 *
 * ONLY DIGITS MAY RIDE THAT QUERY. The customer's name used to come along as
 * name=Michael%20Grosso, and every such call died with "an application error
 * has occurred" (2026-08-11): Vercel's routing layer re-serialises percent-
 * encoding in incoming query strings, so the URL this route reconstructs for
 * the signature check no longer matches the one Twilio signed, and the fetch
 * 403s. Digits are encoding-inert, so `to` is safe; the name is looked up
 * here by phone instead — same tables, same answer, no URL to disagree over.
 *
 * The Dial mirrors /api/voice/outbound exactly — dual-channel recording, same
 * recording callback, status events on the customer leg — so a call-through
 * lands in the log with a recording and transcript like every other call.
 */
export async function POST(request) {
  const url = new URL(request.url);
  const { forbidden } = await readTwilioWebhook(
    request,
    `${webhookUrl(request, "/api/voice/bridge")}${url.search}`,
  );
  if (forbidden) return forbidden;

  const digits = normPhone(url.searchParams.get("to") || "");
  if (digits.length !== 10) {
    return twiml(`<Say>That number can't be dialled from here.</Say><Hangup/>`);
  }

  const { businessNumber, announceRecording, recordingNotice } = voiceConfig();
  const base = baseUrl(request);
  // Shared with the inbound-text alert; best effort, null on any failure —
  // "the customer" must never cost the admin the call.
  const name = await customerNameByPhone(digits);
  const notice = announceRecording ? `<Say>${xml(recordingNotice)}</Say>` : "";

  return twiml(
    `${notice}<Say>Connecting you to ${xml(name || "the customer")}.</Say>` +
      `<Dial callerId="${xml(businessNumber)}" answerOnBridge="true" timeout="30"` +
      ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${xml(`${base}/api/voice/recording`)}"` +
      ` recordingStatusCallbackEvent="completed">` +
      `<Number statusCallback="${xml(`${base}/api/voice/status`)}"` +
      ` statusCallbackEvent="answered completed" method="POST">+1${digits}</Number>` +
      `</Dial>`,
  );
}
