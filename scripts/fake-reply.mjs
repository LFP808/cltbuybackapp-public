/**
 * Post a customer reply through the REAL inbound webhook, correctly signed.
 *
 *   npm run fake-reply -- "yes still sending it"      # ordinary reply
 *   npm run fake-reply -- PAUSE                       # the reminder opt-out
 *   npm run fake-reply -- "hi" --phone=9805551234
 *   npm run fake-reply -- "look" --media=https://example.com/a.jpg
 *
 * The difference from `fake-inbound`, which writes straight to the messages
 * table: this goes through /api/twilio/inbound exactly as Twilio would, so it
 * exercises the parts that only exist on that path — X-Twilio-Signature
 * validation, PAUSE keyword handling and its confirmation text, MessageSid
 * idempotency, and media re-hosting. fake-inbound's own header says to do this;
 * this is that, without hand-rolling curl and an HMAC every time.
 *
 * NO TUNNEL REQUIRED. Twilio never sees it — the signature is computed here
 * with the same auth token the server validates against.
 */
import crypto from "node:crypto";
import { loadEnv } from "./lib/env.mjs";
import { flag, positional } from "./lib/args.mjs";

loadEnv();

const PORT = process.env.PORT || "3000";
// The one hostname there is — the DTS ancestor's app.localtest.me label died
// with the host-based routing.
const HOST = `localhost:${PORT}`;
const body = positional() || "Yes, sending it out tomorrow!";
const phone = String(flag("phone", "9805550142")).replace(/\D/g, "").slice(-10);
const media = flag("media", null);

/**
 * The URL the SERVER will validate against — which is not necessarily the one
 * we post to.
 *
 * The route prefers TWILIO_WEBHOOK_URL when set (that is the tunnel case), and
 * otherwise rebuilds it from the request headers, defaulting the scheme to
 * https because production is always https. Locally the request is plain http,
 * so we send x-forwarded-proto explicitly and sign the same string. Signing the
 * wrong one is a 403 that looks exactly like a real forgery.
 */
const signedUrl = process.env.TWILIO_WEBHOOK_URL || `http://${HOST}/api/twilio/inbound`;
const postUrl = `http://${HOST}/api/twilio/inbound`;

const params = {
  From: `+1${phone}`,
  To: process.env.TWILIO_FROM_NUMBER || "+15550000000",
  Body: body,
  // Idempotency key. A repeat with the same SID is deliberately ignored by the
  // route, so each run gets a fresh one unless you want to test exactly that.
  MessageSid: flag("sid", `SM${crypto.randomBytes(16).toString("hex")}`),
  NumMedia: media ? "1" : "0",
};
if (media) params.MediaUrl0 = media;

/** Twilio's scheme: HMAC-SHA1 over url + each key and value, keys sorted. */
function sign(url, data, token) {
  const payload = Object.keys(data)
    .sort()
    .reduce((acc, key) => acc + key + data[key], url);
  return crypto.createHmac("sha1", token).update(Buffer.from(payload, "utf-8")).digest("base64");
}

const token = process.env.TWILIO_AUTH_TOKEN;
if (!token) {
  console.log(
    "TWILIO_AUTH_TOKEN is not set, so the server will skip signature validation\n" +
      "(see readTwilioWebhook). Posting unsigned — the rest of the path still runs.",
  );
}

const headers = {
  "Content-Type": "application/x-www-form-urlencoded",
  // So the server rebuilds the same http:// URL we signed above.
  "x-forwarded-proto": "http",
  "x-forwarded-host": HOST,
};
if (token) headers["X-Twilio-Signature"] = sign(signedUrl, params, token);

const res = await fetch(postUrl, {
  method: "POST",
  headers,
  body: new URLSearchParams(params),
});
const text = await res.text();

console.log(`POST ${postUrl}`);
console.log(`  signed as : ${signedUrl}`);
console.log(`  from      : +1${phone}`);
console.log(`  body      : ${JSON.stringify(body)}`);
console.log(`  -> ${res.status} ${text.trim().slice(0, 120) || "(empty TwiML)"}`);

if (res.status === 403) {
  console.log(
    "\n403 means the signature did not match. The usual cause is the server\n" +
      "computing a different URL than the one signed above — check\n" +
      "TWILIO_WEBHOOK_URL in .env.local matches, or unset it for local runs.",
  );
  process.exit(1);
}
if (!res.ok) process.exit(1);

// Read it back, because a 200 only proves the route did not throw.
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (U && K) {
  const h = { apikey: K, Authorization: `Bearer ${K}` };
  const rows = await (
    await fetch(
      `${U}/rest/v1/messages?phone=eq.${phone}&order=created_at.desc&limit=3&select=direction,body,auto`,
      { headers: h },
    )
  ).json();
  console.log("\nLast 3 messages for this number:");
  for (const m of rows) {
    console.log(`  ${m.direction.padEnd(8)} ${m.auto ? "[auto] " : ""}${m.body.slice(0, 80)}`);
  }
}
