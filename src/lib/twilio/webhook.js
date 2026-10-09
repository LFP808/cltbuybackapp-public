import { validateTwilioSignature } from "./client";

/**
 * Read and authenticate a Twilio webhook POST, in one motion.
 *
 * Twilio is not a signed-in user; the X-Twilio-Signature header is the only
 * thing standing between these routes and anyone with curl. The
 * parse-flag-header-compare-403 sequence was copy-pasted into seven routes,
 * and an eighth (the voicemail fallback) had simply been missed — which is the
 * failure mode of copy-pasted security: the check lives wherever somebody
 * remembered it. One reader means a route either calls it or visibly doesn't.
 *
 * The caller supplies the signed URL because it genuinely differs per route:
 * the SMS webhooks prefer their exact configured env URLs, the voice routes
 * derive from TWILIO_VOICE_BASE_URL, and the per-leg callback signs its query
 * string. What Twilio signed is route knowledge; how to check it is not.
 *
 * Validation is skipped only when TWILIO_VALIDATE_SIGNATURE="false" (local
 * webhook testing) or no auth token is configured at all.
 *
 * @param {Request} request
 * @param {string} signedUrl the exact URL Twilio signed for this route
 * @returns {Promise<{ params: Record<string, string>, forbidden: Response|null }>}
 *   `params` is always returned; when `forbidden` is set the caller must
 *   return it unhandled — the request is not Twilio's.
 */
export async function readTwilioWebhook(request, signedUrl) {
  // A body that isn't a form (a scanner's empty POST, a curl typo) yields empty
  // params rather than a 500: with validation on, empty params simply fail the
  // signature check, which is the right answer to a request Twilio didn't send.
  const form = await request.formData().catch(() => null);
  const params = {};
  if (form) for (const [key, value] of form.entries()) params[key] = String(value);

  const validate =
    process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VALIDATE_SIGNATURE !== "false";
  if (validate) {
    const signature = request.headers.get("x-twilio-signature");
    if (!validateTwilioSignature(signedUrl, params, signature)) {
      return { params, forbidden: new Response("Invalid signature", { status: 403 }) };
    }
  }

  return { params, forbidden: null };
}
