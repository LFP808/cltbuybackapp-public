import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rehostRemoteMedia } from "@/lib/storage";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { normPhone } from "@/domain/format";
import { REMINDER_OPT_OUT_KEYWORD } from "@/domain/constants";
import { TEMPLATES } from "@/domain/messages";
import { cancelRemindersForPhone } from "@/lib/repositories/reminders";
import { sendAndLog } from "@/lib/messaging";

/**
 * Twilio inbound message webhook. Configure your Twilio number's "A message
 * comes in" webhook to POST here:
 *
 *   https://<your-domain>/api/twilio/inbound
 *
 * Twilio isn't an authenticated user, so this route:
 *   - verifies the request is really from Twilio (X-Twilio-Signature),
 *   - re-hosts any attached media publicly,
 *   - writes the reply with the service-role client (bypassing RLS),
 *   - is idempotent on Twilio's MessageSid (safe to retry),
 *   - replies with empty TwiML (no auto-response).
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(request, webhookUrl(request));
  if (forbidden) return forbidden;

  const from = normPhone(params.From);
  const body = params.Body || "";
  const sid = params.MessageSid || null;
  if (!from) return twiml();

  // --- Re-host the first media attachment (best effort) ----------------------
  let mediaUrl = null;
  const numMedia = parseInt(params.NumMedia || "0", 10);
  if (numMedia > 0 && params.MediaUrl0) {
    try {
      mediaUrl = await rehostRemoteMedia(params.MediaUrl0, {
        sid: process.env.TWILIO_ACCOUNT_SID,
        token: process.env.TWILIO_AUTH_TOKEN,
      });
    } catch (err) {
      // The re-host is best effort; the photo is not. A message saved with
      // neither text nor image is an empty bubble that reads as a glitch, and
      // the photo (usually the phone they want to sell) IS the message. Keep
      // Twilio's own URL instead: the browser loads it directly unless
      // "enforce HTTP auth on media URLs" is switched on in the Twilio
      // console, and Twilio keeps media until it is deleted. Loud in the log
      // either way; the usual cause is the "mms" bucket missing (migration
      // 0004), and a 500 here is not an option: Twilio would retry and
      // duplicate the text.
      console.error("Inbound media re-host failed, keeping Twilio's URL:", err?.message || err);
      mediaUrl = params.MediaUrl0;
    }
  }

  // --- Persist ---------------------------------------------------------------
  const supabase = createAdminClient();
  const { error } = await supabase.from("messages").insert({
    phone: from,
    body,
    media_url: mediaUrl,
    direction: "inbound",
    auto: false,
    test_mode: false,
    provider_sid: sid,
  });

  // Duplicate delivery (same SID) is fine — treat as success.
  if (error && error.code !== "23505") {
    console.error("Failed to store inbound message:", error);
    return new NextResponse("error", { status: 500 });
  }

  // A duplicate delivery already did this work; don't opt them out twice —
  // the 23505 above is the dedupe.
  if (!error) {
    await handleReminderOptOut(from, body);
  }

  return twiml();
}

/**
 * Honour the opt-out keyword by stopping reminders for that customer's open
 * orders.
 *
 * App-level and reminder-only by design. Twilio's STOP is carrier-level and
 * would silence the ordinary conversation too — not what someone declining a
 * nudge is asking for. Scoped to open orders so a future order starts fresh.
 *
 * THE WORD MATTERS: it must not be one Twilio treats as an opt-out itself, or
 * the carrier acts on it first and this handler is decorating a block it cannot
 * see. It was CANCEL, which is exactly that. See REMINDER_OPT_OUT_KEYWORD.
 *
 * Failures here must never fail the webhook: the customer's message is already
 * saved, and Twilio retries a non-200, which would duplicate it.
 */
async function handleReminderOptOut(phone, body) {
  if (body.trim().toUpperCase() !== REMINDER_OPT_OUT_KEYWORD) return;

  try {
    const stopped = await cancelRemindersForPhone(phone);
    if (stopped.length === 0) return; // nothing open; stay silent

    // Confirm, so the opt-out is never met with silence.
    const text = TEMPLATES.reminder_cancelled(stopped[0]);
    await sendAndLog({
      phone,
      orderId: stopped[0].id,
      body: text,
      auto: true,
      sentBy: "Automatic reminder",
      system: true, // no employee session in a webhook
    });
  } catch (err) {
    console.error("Reminder opt-out failed:", err?.message || err);
  }
}

/** The exact URL Twilio signed — prefer an explicit env, else reconstruct. */
function webhookUrl(request) {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  return `${proto}://${host}/api/twilio/inbound`;
}

/** Empty TwiML response (acknowledge, no auto-reply). */
function twiml() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
