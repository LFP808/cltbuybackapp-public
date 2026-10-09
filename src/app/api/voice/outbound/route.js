import { voiceConfig, baseUrl, webhookUrl, twiml, xml } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { upsertCall } from "@/lib/repositories/calls";
import { createAdminClient } from "@/lib/supabase/admin";
import { normPhone } from "@/domain/format";

/**
 * TwiML for a call placed FROM the browser — the click-to-call button.
 *
 * This is the Voice URL of the TwiML app the access token is scoped to. The
 * softphone connects with a `To` parameter; we decide what that means and
 * dial it, presenting the business number so the customer sees the company
 * rather than an unknown Twilio number.
 *
 * THE DESTINATION IS SANITISED HERE. A token holder controls the parameters
 * they send, so an unchecked `To` is a way to bill international calls to this
 * account. Only ten-digit US numbers get dialled.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/outbound"),
  );
  if (forbidden) return forbidden;

  const { businessNumber } = voiceConfig();
  const digits = normPhone(params.To);
  if (digits.length !== 10) {
    return twiml(`<Say>That number can't be dialled from here.</Say><Hangup/>`);
  }

  const base = baseUrl(request);
  const identity = params.From || params.Caller || ""; // "client:<uuid>"
  const staffId = identity.replace(/^client:/, "");

  // WHO is allowed to dial WHOM. A token says "may place calls" and nothing
  // more, so the only place the destination can be judged is here, where it
  // is finally known. Every phone-holding role may ring anyone today; the
  // active check below is the judgement that remains.
  let name = null;
  try {
    const supabase = createAdminClient();
    const { data: profile } = staffId
      ? await supabase
          .from("profiles")
          .select("full_name, role, active")
          .eq("id", staffId)
          .maybeSingle()
      : { data: null };
    name = profile?.full_name?.trim() || null;

    // A DEACTIVATED LOGIN CAN STILL HOLD A LIVE TOKEN. The Twilio access token
    // is minted for an hour and cannot be revoked; this route authenticates by
    // Twilio signature, not the session, so the GoTrue ban that stops a
    // deactivated staffer everywhere else never reaches here - and the admin
    // client above bypasses the RLS that would. Re-checking active at call
    // time is the only thing that stops a just-fired staffer placing recorded
    // calls as the business for the rest of the token's life. Null is treated
    // as active, matching is_staff()'s coalesce(active, true).
    if (staffId && (!profile || profile.active === false)) {
      return twiml(`<Say>That call can't be placed from this account.</Say><Hangup/>`);
    }
  } catch (err) {
    // Failing open here would mean an unchecked destination, so it fails shut.
    console.error("Outbound authorisation failed:", err?.message || err);
    return twiml(`<Say>That call can't be placed right now.</Say><Hangup/>`);
  }

  try {
    await upsertCall(params.CallSid, {
      direction: "outbound",
      from_number: businessNumber,
      to_number: `+1${digits}`,
      phone: digits,
      status: "ringing",
      answered_by: staffId || undefined,
      answered_name: name || undefined,
    });
  } catch (err) {
    console.error("Outbound call log failed:", err?.message || err);
  }

  return twiml(
    `<Dial callerId="${xml(businessNumber)}" answerOnBridge="true" timeout="30"` +
      ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${xml(`${base}/api/voice/recording`)}"` +
      ` recordingStatusCallbackEvent="completed">` +
      `<Number statusCallback="${xml(`${base}/api/voice/status`)}"` +
      ` statusCallbackEvent="answered completed" method="POST">+1${digits}</Number>` +
      `</Dial>`,
  );
}
