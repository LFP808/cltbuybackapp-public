import crypto from "crypto";
import { isMessagingEnabled, isSmsAllowed, smsAllowlist } from "@/domain/mode";
import { foldToGsm7 } from "@/domain/sms";

/**
 * Twilio SMS/MMS service, ported from the original server. While
 * SMS_TEST_MODE is on, messages are logged instead of sent, so every texting
 * flow can be exercised with no Twilio account and no risk of texting real
 * people.
 */

/**
 * Whether outbound texts are logged instead of sent.
 *
 * THE DEFAULT DEPENDS ON WHERE THIS RUNS, because the dangerous mistake is the
 * opposite one in each place. On a developer's machine an unset variable must
 * mean "don't text anyone"; in production it must mean "text people", because
 * test mode in production is SILENT — the digest cron counts a console.log as
 * delivered and reports {sent: N}. A single default could only be safe at one
 * end, and it was safe at the wrong one: production shipped with the value
 * unset would have texted nobody, ever, while every screen and log said it
 * had.
 *
 * An explicit true/false still wins in both environments — that is what
 * lets a developer point at production and stay quiet, and what lets a
 * rehearsal deploy go out muted on purpose. "1"/"0" are accepted as
 * synonyms because SMS_TEST_MODE=1 is what people actually type, and the
 * old exact-match parse silently fell through to the NODE_ENV default —
 * which under `next start` on a dev machine meant REAL-SEND mode wearing a
 * test-mode label (found by preflight, 2026-08-13).
 */
export function isSmsTestMode() {
  const flag = String(process.env.SMS_TEST_MODE ?? "").toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Verify that an inbound webhook request genuinely came from Twilio, using the
 * X-Twilio-Signature header. Recomputes the HMAC-SHA1 of (URL + params) with
 * the account auth token and compares in constant time.
 *
 * @param {string} url        the exact webhook URL Twilio was configured with
 * @param {Record<string,string>} params  the POST body params
 * @param {string} signature  the X-Twilio-Signature header value
 */
export function validateTwilioSignature(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto
    .createHmac("sha1", token)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Send (or, in test mode, log) an SMS/MMS.
 * @param {{ to: string, body: string, mediaUrl?: string|null }} message
 */
export async function sendSms({ to, body, mediaUrl }) {
  // FOLDED AT THE FLOOR, so every path gets it: the templates are policed for
  // GSM-7 by scripts/check-sms-encoding.mjs, but the NAMES interpolated into
  // them are not, and one í re-encodes the whole message as UCS-2 at roughly
  // double the cost. Here rather than per-caller for the same reason as the
  // kill switch below — the digest and the inbound alerts do not go through
  // sendAndLog.
  body = foldToGsm7(body);

  // THE KILL SWITCH, and it sits below test mode on purpose: this is the floor
  // every outbound path crosses, including the staff alerts that do not go
  // through sendAndLog. Off means off — no Twilio call, no console noise
  // pretending something was composed. Callers that also write a row check
  // isMessagingEnabled themselves, because by the time we are here it is too
  // late to stop the logging.
  if (!isMessagingEnabled()) {
    return { disabled: true, sid: null, status: null, to, body, mediaUrl: mediaUrl || null };
  }

  // THE FENCE, checked before test mode so it holds in exactly the configuration
  // it exists for: SMS_TEST_MODE=false on a developer's machine, pointed at the
  // production database. THROWS rather than silently dropping — a guard that
  // swallows the send looks identical to a send that worked, which is how you
  // end up believing you tested something.
  if (!isSmsAllowed(to)) {
    throw new SmsBlockedError(to, smsAllowlist());
  }

  if (isSmsTestMode()) {
    // eslint-disable-next-line no-console
    console.log(
      `[SMS TEST MODE] Would text ${to}: ${body}${mediaUrl ? ` [image: ${mediaUrl}]` : ""}`,
    );
    return { testMode: true, sid: null, status: null, to, body, mediaUrl: mediaUrl || null };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new Error(
      "Twilio is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).",
    );
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  if (mediaUrl) params.append("MediaUrl", mediaUrl);

  // Ask Twilio to report what happened after it accepts the message. Without
  // this, "sent" only ever means "Twilio took it", not "the customer got it".
  const callback = statusCallbackUrl();
  if (callback) params.append("StatusCallback", callback);

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await r.json();
  if (!r.ok) throw new SmsError(data.message || "Twilio request failed.", data.code);
  return { sid: data.sid, status: data.status, testMode: false };
}

/** Absolute URL Twilio posts delivery updates to, or null when unconfigured. */
function statusCallbackUrl() {
  const base = process.env.TWILIO_STATUS_CALLBACK_URL || process.env.PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/api/twilio/status` : null;
}

/**
 * Place a phone call through the Twilio REST API.
 *
 * The voice sibling of sendSms above, for the admin call-through: Twilio rings
 * `to` from the business number, and when it is answered fetches TwiML from
 * `url` to decide what happens next. The caller owns every policy question
 * (who may call whom, test mode, kill switch) — this is only the wire.
 *
 * `timeout` is seconds of ringing before Twilio gives up. It exists here
 * because the call-through's first leg is a personal cell: past ~25 seconds
 * the carrier's voicemail answers, the TwiML runs into the mailbox, and the
 * customer gets connected to a recording of Jaime's voicemail greeting.
 *
 * @param {{to: string, url: string, statusCallback?: string, timeout?: number}} opts
 * @returns {Promise<{sid: string, status: string}>}
 */
export async function placeCall({ to, url, statusCallback, timeout = 20 }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new Error(
      "Twilio is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).",
    );
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Url: url, Timeout: String(timeout) });
  if (statusCallback) {
    params.append("StatusCallback", statusCallback);
    // Ringing/answered keep the live call log honest while the call is up;
    // completed is what closes the row (its CallStatus carries the final
    // state, no-answer included).
    for (const ev of ["ringing", "answered", "completed"]) {
      params.append("StatusCallbackEvent", ev);
    }
  }

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Twilio call request failed.");
  return { sid: data.sid, status: data.status };
}

/**
 * Twilio's code for "the recipient has replied STOP". The number is blocked at
 * the carrier until they text START — retrying can never succeed, so this is
 * treated as a durable state rather than a transient failure.
 */
export const TWILIO_OPTED_OUT_CODE = 21610;

/**
 * Refused by our own allowlist, not by the carrier.
 *
 * Its own class so userFacingSendError can show it as an explanation rather
 * than a fault: seeing "blocked by SMS_ALLOWLIST" is the guard doing its job,
 * and a generic error would send somebody debugging Twilio.
 */
export class SmsBlockedError extends Error {
  constructor(to, allowed) {
    super(
      `SMS_ALLOWLIST is set, and ${to} is not on it. ` +
        `Texting is fenced to: ${allowed.join(", ") || "(none)"}. ` +
        "Unset SMS_ALLOWLIST to text everyone.",
    );
    this.name = "SmsBlockedError";
    this.to = to;
  }
}

/** A Twilio rejection, carrying its numeric code so callers can branch on it. */
export class SmsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SmsError";
    this.code = code;
  }

  /** True when this failure means the customer opted out via STOP. */
  get isOptOut() {
    return Number(this.code) === TWILIO_OPTED_OUT_CODE;
  }
}
