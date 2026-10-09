import { createDeviceInquiry } from "@/lib/repositories/device-inquiries";
import { validateDeviceInquiry } from "@/domain/device-inquiries";

/**
 * Public intake for the marketing site's "sell your device" quote wizard.
 * Replaces a Formspree submission — this is the ONLY route in the app a
 * signed-out browser may write through.
 *
 * Nothing client-side can carry a real secret (it ships in the page source),
 * so this is light guardrails, not auth: an Origin check, a non-secret site
 * key, and the wizard's existing honeypot field. That's deliberately the same
 * bar Formspree itself cleared, not an attempt at something stronger.
 *
 * CORS, read carefully: the request is cross-origin (the site and the app
 * are different hosts), and `Accept` + multipart `FormData` are CORS-"simple"
 * so the browser sends this POST with no preflight. That means THIS route is
 * the only place access control happens — there is no OPTIONS handler to lean
 * on. And because the wizard's fetch() branches on `r.ok`, every response,
 * success or rejection, that the browser is MEANT to be able to read must
 * carry `Access-Control-Allow-Origin`. Only the wrong-origin case omits it on
 * purpose, so the browser blocks the read entirely and the wizard's .catch()
 * fires — the one response that should look like a network failure.
 */
export async function POST(request) {
  const allowedOrigin = process.env.DEVICE_INQUIRY_SITE_ORIGIN;
  if (!allowedOrigin) {
    return json({ error: "DEVICE_INQUIRY_SITE_ORIGIN is not set; refusing to run." }, 503);
  }

  const origin = request.headers.get("origin");
  if (origin !== allowedOrigin) {
    // No Access-Control-Allow-Origin: the browser can't read this response at
    // all, which is the point — a cross-origin bot gets a result
    // indistinguishable from a dropped connection, not a readable 403.
    return json({ error: "Forbidden" }, 403);
  }

  const corsHeaders = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Bad request" }, 400, corsHeaders);
  }

  const field = (name) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  // Non-secret deterrent against drive-by bots hitting the endpoint directly
  // (it ships in the site's page source same as the form fields do) — not a
  // real auth check, same honesty as the Origin check above.
  if (field("site_key") !== process.env.DEVICE_INQUIRY_SITE_KEY) {
    return json({ error: "Forbidden" }, 403, corsHeaders);
  }

  // Honeypot: real visitors never fill this hidden field. Accept-and-drop
  // rather than reject, so a bot that found the field never learns it was
  // rejected.
  if (field("_gotcha")) {
    return json({ ok: true }, 200, corsHeaders);
  }

  const input = {
    name: field("name").trim(),
    phone: field("phone").trim(),
    smsConsent: field("sms_consent"),
    sourcePage: field("source_page").trim(),
    adParams: field("ad_params").trim(),
    brand: field("brand").trim(),
    model: field("model").trim(),
    carrier: field("carrier").trim(),
    condition: field("condition").trim(),
    issues: field("issues").trim(),
    sellMethod: field("sell_method").trim(),
    itemCount: field("item_count").trim(),
    deviceSummary: field("device_summary").trim(),
  };

  const errors = validateDeviceInquiry(input);
  if (Object.keys(errors).length) {
    return json({ error: "Missing required fields", fieldErrors: errors }, 400, corsHeaders);
  }

  try {
    await createDeviceInquiry(input);
  } catch (err) {
    console.error("Failed to store device inquiry:", err?.message || err);
    return json({ error: "Failed to save inquiry" }, 500, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
}

function json(payload, status, extraHeaders = {}) {
  return Response.json(payload, { status, headers: extraHeaders });
}
