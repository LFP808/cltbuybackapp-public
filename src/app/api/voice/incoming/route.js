import { voiceConfig, baseUrl, webhookUrl, twiml, xml } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { ringTargets, ringTwiml, NOBODY_TO_RING } from "@/lib/twilio/ring";
import { textMissedCaller } from "@/lib/missed-call-text";
import { upsertCall } from "@/lib/repositories/calls";
import { getIncomingCalls } from "@/lib/repositories/settings";
import { businessName } from "@/lib/business";
import { menuPrompt, TOLD_TO_TEXT } from "@/domain/phone-menu";
import { normPhone } from "@/domain/format";

/**
 * Twilio Voice webhook — "A call comes in" on the business number.
 *
 *   https://<your-domain>/api/voice/incoming
 *
 * Logs the call, then does one of three things, chosen on /settings
 * (`incoming_calls`, modes in domain/phone-menu.js):
 *
 *   message  NOTHING RINGS. The caller hears one sentence ("All of our
 *            employees are busy at the moment. Text us..."), is sent the
 *            missed-call text to reply to, and the call ends. The default:
 *            texting is the channel this business answers.
 *   menu     "This is CLT Buyback. To sell a device, press 1...", then
 *            /api/voice/menu acts on the key and rings everyone.
 *   ring     rings everyone straight away, as it did before either existed.
 *
 * The ringing itself - who, how, the recording, the voicemail fallback - is
 * lib/twilio/ring.js, shared with /api/voice/menu.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/incoming"),
  );
  if (forbidden) return forbidden;

  const { businessNumber } = voiceConfig();
  const callSid = params.CallSid;
  const from = params.From || "";

  // `system: true`: Twilio has no session, and a session read would hand
  // back the defaults whatever /settings says. Never throws - a failed read
  // IS the default (don't ring, standard message).
  const { mode, message } = await getIncomingCalls({ system: true });
  const now = new Date().toISOString();

  // Log it before anything else happens, so a call that nobody answers - the
  // ones most worth seeing - still appears in the log.
  try {
    await upsertCall(callSid, {
      direction: "inbound",
      from_number: from,
      to_number: params.To || businessNumber,
      phone: normPhone(from),
      // In message mode the call is over the moment this response is spoken,
      // so it is logged as ended HERE rather than left "ringing" on the hope
      // that Twilio's status callback is configured and arrives. When it does
      // arrive it says the same thing and adds the duration.
      ...(mode === "message" ? { status: "completed", ended_at: now } : { status: "ringing" }),
    });
  } catch (err) {
    // A logging failure must never stop a customer's call being handled.
    console.error("Call log write failed:", err?.message || err);
  }

  if (mode === "message") {
    await Promise.all([
      markAutoAnswer(callSid, { menu_at: now, menu_choice: TOLD_TO_TEXT }),
      // The text they are being told to send a reply to. Swallows its own
      // failures: opted out, a landline, texting switched off - the caller
      // still hears the message.
      textMissedCaller(callSid, normPhone(from)),
    ]);
    return twiml(
      // A beat of silence first: the first half-second after pickup is
      // routinely clipped, and "...of our employees are busy" is a worse
      // message.
      `<Pause length="1"/><Say>${xml(message)}</Say><Hangup/>`,
    );
  }

  const targets = await ringTargets();
  if (!targets.any) return twiml(NOBODY_TO_RING);
  if (mode === "ring") return twiml(ringTwiml(request, targets));

  await markAutoAnswer(callSid, { menu_at: now });

  // ONE <Gather> wrapped around the greeting, so a key pressed mid-sentence
  // is taken at once, followed by a <Redirect> to the same menu route:
  // Twilio only requests a Gather's action when a digit arrives, and the
  // redirect is what turns five seconds of silence into "ring them through
  // anyway" instead of a dropped call.
  const menu = xml(`${baseUrl(request)}/api/voice/menu`);
  return twiml(
    `<Gather numDigits="1" timeout="5" action="${menu}" method="POST">` +
      `<Pause length="1"/>` +
      `<Say>${xml(menuPrompt(businessName()))}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">${menu}</Redirect>`,
  );
}

/**
 * Stamp what the auto-answer did with this call (`menu_at`, `menu_choice`).
 *
 * Its OWN write, after the log row rather than folded into it: migrations
 * are run by hand on the cloud project, and on a database without 0009 these
 * columns don't exist. Folded in, that would cost the whole log row; apart,
 * it costs only this bookkeeping.
 */
async function markAutoAnswer(callSid, patch) {
  try {
    await upsertCall(callSid, patch);
  } catch (err) {
    console.error("Auto-answer mark failed (migration 0009 run?):", err?.message || err);
  }
}
