import { createHmac } from "node:crypto";

/**
 * Mint a Twilio Voice access token for the browser softphone.
 *
 * A Twilio access token is an ordinary HS256 JWT signed with an API Key Secret
 * - not the account auth token - carrying the grants the SDK is allowed to
 * use. Hand-rolled rather than pulling in the whole `twilio` package for one
 * signature, matching how webhook signature validation is already done here.
 *
 * THE SECRET NEVER LEAVES THE SERVER. The browser receives only the finished
 * token, which expires, is scoped to one identity, and grants exactly two
 * things: receive calls addressed to that identity, and place calls through
 * our TwiML app (whose URL we control, so a token holder cannot dial anywhere
 * they like on our account).
 */

/** Twilio's own header shape for these tokens. */
const HEADER = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * @param {object} opts
 * @param {string} opts.identity who the token is for — the staff profile id,
 *   which is also what incoming TwiML dials as <Client>
 * @param {boolean} [opts.canReceive] whether calls may ring this device.
 *   Enforced in the grant rather than only in the TwiML that picks who to
 *   ring, so a device excluded from the ring group cannot be rung by anything.
 * @param {number} [opts.ttlSeconds] default one hour; the SDK refreshes before
 *   this elapses, and a short life limits the damage of a leaked token
 * @returns {string} the signed JWT
 */
export function voiceAccessToken({ identity, canReceive = true, ttlSeconds = 3600 }) {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid } = voiceCredentials();
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error(
      "Voice is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, " +
        "TWILIO_API_KEY_SECRET and TWILIO_TWIML_APP_SID.",
    );
  }
  if (!identity) throw new Error("An access token needs an identity.");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    exp: now + ttlSeconds,
    grants: {
      identity: String(identity),
      voice: {
        // Take calls that TwiML sends to <Client>identity</Client>.
        incoming: { allow: Boolean(canReceive) },
        // Place calls, but only through our application — the TwiML app points
        // at our own endpoint, so the destination is decided server-side.
        outgoing: { application_sid: twimlAppSid },
      },
    },
  };

  const signingInput = `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", apiKeySecret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${signature}`;
}

/** Voice credentials, read in one place so "is this configured" has one answer. */
export function voiceCredentials() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    apiKeySid: process.env.TWILIO_API_KEY_SID || "",
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || "",
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID || "",
  };
}

/** Whether browser calling can work at all — used to hide the softphone. */
export function isVoiceConfigured() {
  const c = voiceCredentials();
  return Boolean(c.accountSid && c.apiKeySid && c.apiKeySecret && c.twimlAppSid);
}
