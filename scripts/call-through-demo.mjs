/**
 * Verify the admin call-through button end to end, WITHOUT placing a call:
 * dev runs with SMS_TEST_MODE defaulting on, so the action must refuse with
 * the test-mode message — which proves button → modal → action → guard wiring.
 * Also proves the button is admin-only by checking a VA never sees it.
 */
import { chromium } from "playwright";
// lib/app.mjs runs loadEnv() at import, with .env.local ahead of any
// legacy .env.local — parsing .env.local by hand here once pointed this
// script's seeding at the wrong database.
import { APP, signIn } from "./lib/app.mjs";

const DB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const errors = [];
const expect = (cond, label) => {
  console.log(`${cond ? "   ✓" : "   ✗ FAILED:"} ${label}`);
  if (!cond) errors.push(label);
};

// Seed one finished inbound call so /calls has a row to call back.
const rows = await fetch(`${DB}/rest/v1/calls`, {
  method: "POST",
  headers,
  body: JSON.stringify([
    {
      call_sid: "ZZ_CALLTHROUGH_TEST",
      direction: "inbound",
      from_number: "+19805559111",
      to_number: process.env.TWILIO_FROM_NUMBER || "+19800000000",
      phone: "9805559111",
      status: "completed",
    },
  ]),
}).then((r) => r.json());
const rowId = rows[0]?.id;
console.log(`Seeded call row ${rowId}`);

const browser = await chromium.launch({ headless: true });
try {
  // --- admin sees the button, and the action's guard answers ---------------
  let page = await browser.newPage();
  await signIn(page, "admin", { base: APP });
  await page.goto(`${APP}/calls`, { waitUntil: "networkidle" });

  const btn = page.getByRole("button", { name: "Call (980) 555-9111 via your phone" });
  expect(await btn.isVisible().catch(() => false), "admin sees the Call back button");

  await btn.click();
  const dialog = page.getByText(/Your own phone rings first/);
  expect(await dialog.isVisible().catch(() => false), "confirm dialog explains the call-through");

  await page.getByRole("button", { name: "Ring my phone" }).click();
  const refusal = page.getByText(/Test mode is on - calls are not placed/);
  expect(
    await refusal
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false),
    "action wired end to end (test-mode guard refused the dial)",
  );
  await page.screenshot({ path: "screenshots/call-through-admin.png" });
  await page.close();

  // --- a VA gets no button at all ------------------------------------------
  page = await browser.newPage();
  await signIn(page, "va", { base: APP });
  await page.goto(`${APP}/calls`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Calls" }).waitFor({ timeout: 10000 });
  const vaSees = await page
    .getByRole("button", { name: /via your phone/ })
    .first()
    .isVisible()
    .catch(() => false);
  expect(!vaSees, "a VA never sees the Call back button");
  await page.screenshot({ path: "screenshots/call-through-va.png" });
  await page.close();
} finally {
  await browser.close();
  if (rowId) {
    await fetch(`${DB}/rest/v1/calls?id=eq.${rowId}`, { method: "DELETE", headers });
    console.log("Cleaned up the seeded call.");
  }
}

if (errors.length) {
  console.log(`\n❌ ${errors.length} problem(s)`);
  process.exit(1);
}
console.log("\n✅ Call-through verified (button, gate, and guard).");
