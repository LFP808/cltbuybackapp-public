/**
 * Pretend a call is happening, so the call log and its live updates can be
 * tested without Twilio, a phone, or a public URL.
 *
 *   npm run fake-call                      # a full inbound call, ringing -> answered -> ended
 *   npm run fake-call -- --missed          # rings, nobody picks up
 *   npm run fake-call -- --outbound
 *   npm run fake-call -- --phone=9805551234 --ring=6
 *
 * Writes the same rows the Twilio webhooks would, in the same order and with
 * real gaps between them, so what you are watching is the actual sequence:
 * a row appears while it rings, gains an answerer, then a duration, then a
 * recording and transcript.
 *
 * It does NOT exercise the webhooks themselves (signature validation, TwiML,
 * the Voice SDK). Those need a real Twilio number pointed at a public URL.
 */
import { loadEnv } from "./lib/env.mjs";
import { randomUUID } from "node:crypto";
import { flag, has } from "./lib/args.mjs";

loadEnv();

const missed = has("missed");
const outbound = has("outbound");
const ringSecs = Number(flag("ring", 4));
const talkSecs = Number(flag("talk", 6));

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error("Missing Supabase config in .env.local.");

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const TRANSCRIPT = [
  "Customer: Hi, I have an iPhone 15 Pro Max I'm looking to sell and wanted to see what you'd pay.",
  "Agent: Sure, let me help with that. What's the storage size, and is it unlocked?",
  "Customer: It's the 256 gig, unlocked, screen's perfect.",
  "Agent: Sounds good. Bring it by and we'll check the IMEI and make you an offer on the spot.",
  "Customer: Can I come by tomorrow morning?",
  "Agent: Absolutely, I'll book you in for 10. Anything else you're bringing?",
  "Customer: Maybe my old Apple Watch too. Thanks!",
].join("\n");

/** Reuse a real customer so the log shows a name and links somewhere. */
async function pickPhone() {
  const explicit = flag("phone", null);
  if (explicit) return explicit.replace(/\D/g, "").slice(-10);
  const res = await fetch(`${URL_BASE}/rest/v1/orders?select=phone&order=created_at.desc&limit=1`, {
    headers,
  });
  const rows = await res.json();
  return rows[0]?.phone || "9805550123";
}

/** Whoever picks up, when someone does. */
async function pickStaff() {
  const res = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,full_name&limit=1`, { headers });
  const rows = await res.json();
  return rows[0] || null;
}

async function write(callSid, patch) {
  const res = await fetch(`${URL_BASE}/rest/v1/calls?on_conflict=call_sid`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ call_sid: callSid, ...patch }),
  });
  if (!res.ok) {
    console.error(`Write failed (${res.status}):`, (await res.json()).message);
    process.exit(1);
  }
}

const phone = await pickPhone();
const staff = await pickStaff();
const callSid = `CA${randomUUID().replace(/-/g, "")}`.slice(0, 34);
const business = process.env.TWILIO_FROM_NUMBER || "+19805550000";

console.log(`${outbound ? "Calling" : "Call from"} ${phone} (${callSid})`);

await write(callSid, {
  direction: outbound ? "outbound" : "inbound",
  from_number: outbound ? business : `+1${phone}`,
  to_number: outbound ? `+1${phone}` : business,
  phone,
  status: "ringing",
  started_at: new Date().toISOString(),
});
console.log(`  ringing for ${ringSecs}s...`);
await sleep(ringSecs);

if (missed) {
  await write(callSid, { status: "no-answer", ended_at: new Date().toISOString() });
  console.log("  nobody answered — shows as Missed.");
  process.exit(0);
}

await write(callSid, {
  status: "in-progress",
  answered_by: staff?.id ?? null,
  answered_name: staff?.full_name ?? "Staff",
});
console.log(`  answered by ${staff?.full_name || "Staff"}, talking for ${talkSecs}s...`);
await sleep(talkSecs);

await write(callSid, {
  status: "completed",
  ended_at: new Date().toISOString(),
  duration_secs: ringSecs + talkSecs,
  transcript_status: "pending",
});
console.log("  ended — transcript pending...");
await sleep(3);

await write(callSid, { transcript: TRANSCRIPT, transcript_status: "ready" });
console.log("  transcript ready.\n");
console.log("Open /calls with the app running to watch this happen live.");
