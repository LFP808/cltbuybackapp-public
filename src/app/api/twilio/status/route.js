import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TWILIO_OPTED_OUT_CODE } from "@/lib/twilio/client";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { setSmsOptedOut } from "@/lib/repositories/contact-notes";
import { normPhone } from "@/domain/format";

/**
 * Twilio delivery status webhook.
 *
 * Twilio POSTs here as a message moves through queued -> sent -> delivered, or
 * lands on undelivered/failed. Without it "sent" only ever meant "Twilio
 * accepted it", and a text that never reached the customer looked identical in
 * the thread to one that did.
 *
 * Configure by setting TWILIO_STATUS_CALLBACK_URL (or PUBLIC_BASE_URL) — the
 * outbound send passes it per-message, so no console configuration is needed.
 *
 * Like the inbound webhook, Twilio is not an authenticated user: the request is
 * verified by signature and written with the service role.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(request, statusUrl(request));
  if (forbidden) return forbidden;

  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) return ok();

  const errorCode = params.ErrorCode || null;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("messages")
    .update({ delivery_status: status, delivery_error: errorCode })
    .eq("provider_sid", sid);

  if (error) {
    console.error("Failed to record delivery status:", error);
    return new NextResponse("error", { status: 500 });
  }

  // A failure carrying 21610 is the carrier telling us this person texted STOP.
  // Recording it here as well as on the send path matters because the block can
  // land asynchronously, after Twilio already accepted the message.
  if (Number(errorCode) === TWILIO_OPTED_OUT_CODE && params.To) {
    try {
      await setSmsOptedOut(normPhone(params.To), true);
    } catch (err) {
      console.error("Failed to record opt-out from status callback:", err?.message || err);
    }
  }

  return ok();
}

/** The exact URL Twilio signed — prefer an explicit env, else reconstruct. */
function statusUrl(request) {
  const configured = process.env.TWILIO_STATUS_CALLBACK_URL;
  if (configured) return configured;
  const base = process.env.PUBLIC_BASE_URL;
  if (base) return `${base.replace(/\/$/, "")}/api/twilio/status`;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  return `${proto}://${host}/api/twilio/status`;
}

function ok() {
  // null, not "": the Response spec forbids ANY body on a 204, empty string
  // included, and the constructor throws — which turned every callback that
  // passed validation into a 500 AFTER the status was already written. Twilio
  // then retried a webhook that had actually succeeded.
  return new NextResponse(null, { status: 204 });
}
