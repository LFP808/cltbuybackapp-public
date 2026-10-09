/**
 * Pretend a customer just texted in, so notifications can be tested without a
 * phone or a live Twilio number.
 *
 *   npm run fake-inbound                          # random message from a known customer
 *   npm run fake-inbound -- "still have that iPhone if you want it"
 *   npm run fake-inbound -- "hello" --phone=9805551234
 *   npm run fake-inbound -- --count=3 --delay=4    # a small burst, 4s apart
 *
 * Writes straight to the messages table with the service role, which is exactly
 * what the Twilio webhook does. Supabase Realtime broadcasts the insert, the
 * open app chimes and the bell count goes up — no tunnel, no carrier, no cost.
 *
 * It does NOT exercise the real inbound webhook (signature validation, STOP and
 * PAUSE keyword handling, media). For that, use `npm run fake-reply`, which
 * posts a signed form-encoded body to /api/twilio/inbound.
 */
import { loadEnv } from "./lib/env.mjs";
import { flag, positional } from "./lib/args.mjs";

loadEnv();

const body = positional();
const count = Number(flag("count", 1));
const delay = Number(flag("delay", 3)) * 1000;

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error("Missing Supabase config in .env.local.");

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const SAMPLES = [
  "Hi, have an iPhone 15 Pro Max to sell, how much?",
  "Running about 10 min late for my appointment",
  "Do you buy MacBooks too? 2023 Air, barely used",
  "Can I move my meetup to Friday instead?",
  "It's carrier locked to AT&T, is that a problem?",
  "Just checking on my Zelle payment, thanks!",
];

/** Reuse a real customer's number so the bell shows a name, not "Unknown". */
async function pickPhone() {
  const explicit = flag("phone", null);
  if (explicit) return explicit.replace(/\D/g, "").slice(-10);

  const res = await fetch(
    `${URL_BASE}/rest/v1/orders?select=phone,name&order=created_at.desc&limit=1`,
    { headers },
  );
  const rows = await res.json();
  if (rows[0]?.phone) return rows[0].phone;

  console.log("No customers in the database — using a placeholder number.");
  return "9805550123";
}

const phone = await pickPhone();

for (let i = 0; i < count; i++) {
  const text = body || SAMPLES[i % SAMPLES.length];
  const res = await fetch(`${URL_BASE}/rest/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      phone,
      body: text,
      direction: "inbound",
      auto: false,
      test_mode: true,
    }),
  });

  if (!res.ok) {
    console.error(`Failed (${res.status}):`, (await res.json()).message);
    process.exit(1);
  }
  console.log(`Inbound from ${phone}: "${text}"`);

  if (i < count - 1) await new Promise((r) => setTimeout(r, delay));
}

console.log(`\nDone. The open app should have chimed and bumped the bell.`);
console.log(`Clear them by opening the conversation, which marks it read.`);
