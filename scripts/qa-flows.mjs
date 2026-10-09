/**
 * The recovery flows, driven at human speed in a browser you can watch.
 *
 *   npm run qa:flows                  # visible browser, ~600ms between steps
 *   npm run qa:flows -- --speed=1000  # slower
 *   npm run qa:flows -- --headless
 *
 * Six flows, all meetup/walk-in shaped (the only shapes there are):
 *
 *   1. Edit a meetup that was typed wrong
 *   2. Reschedule its appointment
 *   3. Cancel it, with a reason
 *   4. Record a no-show, then rebook the same order
 *   5. Create a walk-in with its payout at the counter
 *   6. Correct that payout after the fact
 *
 * Each step is captioned on the page itself, so what you are watching explains
 * itself and the screenshots are readable afterwards.
 *
 * Everything it creates is named "ZZ QA …" and deleted at the end, including
 * after a failure. Driven as the VA on purpose: the VA runs the desk, and a
 * flow the VA can't complete is a finding.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { flag, has } from "./lib/args.mjs";
import { APP, signIn } from "./lib/app.mjs";

const BASE = APP;
const SPEED = Number(flag("speed", 600));
const HEADLESS = has("headless");
const SHOTS = "screenshots/qa-flows";
mkdirSync(SHOTS, { recursive: true });

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const created = [];
let shotNo = 0;
const failures = [];

const dayAhead = (days) => {
  const n = new Date(Date.now() + days * 86400000);
  return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Book through the slot picker — the only input since the 2026-08-13
 * rebuild: tap a day on the strip, then a time chip. The admin schedule
 * rules what exists, so a closed day falls through to the next candidate
 * and a missing time falls back to the day's first free chip. Returns
 * {date, time} read back from the hidden fields the picker writes, so the
 * DB assertions compare against what the UI really booked.
 */
async function pickSlot(page, dates, timeLabel, ids) {
  for (const date of dates) {
    const day = page.getByRole("button", { name: `Day ${date}`, exact: true });
    if ((await day.count()) === 0 || (await day.isDisabled())) continue;
    await day.click();
    const wanted = page.getByRole("button", { name: `Book ${date} ${timeLabel}`, exact: true });
    const chip = (await wanted.count())
      ? wanted.first()
      : page.getByRole("button", { name: `Book ${date}` }).first();
    if ((await chip.count()) === 0) continue; // day fully booked or empty
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    return {
      date: await page.locator(ids.date).inputValue(),
      time: await page.locator(ids.time).inputValue(),
    };
  }
  throw new Error("no bookable slot found among the candidate days");
}

/** Seed an order directly, so each flow starts from exactly the state it tests. */
async function seed(fields) {
  const { data, error } = await svc
    .from("orders")
    .insert({ type: "office", status: "awaiting", items: [], est_value: 0, ...fields })
    .select()
    .single();
  if (error) throw new Error(`seed failed: ${error.message}`);
  created.push(data.id);
  return data;
}

async function step(page, title, detail = "") {
  console.log(`\n▸ ${title}${detail ? ` — ${detail}` : ""}`);
  await page
    .evaluate(
      ([t, d]) => {
        document.getElementById("qa-banner")?.remove();
        const el = document.createElement("div");
        el.id = "qa-banner";
        el.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;" +
          "background:#17211C;" +
          "color:#fff;font:600 14px/1.5 system-ui,sans-serif;padding:13px 20px;display:flex;gap:12px";
        el.innerHTML =
          `<span style="color:#8FCBA5;white-space:nowrap">${t}</span>` +
          (d ? `<span style="opacity:.8;font-weight:400">${d}</span>` : "");
        document.body.appendChild(el);
      },
      [title, detail],
    )
    .catch(() => {});
  await page.waitForTimeout(SPEED);
}

async function shot(page, name) {
  const f = join(SHOTS, `${String(++shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: f, fullPage: true }).catch(() => {});
}

/** Assert against the database, which is the only place the truth actually is. */
async function expectRow(id, checks, label) {
  const { data } = await svc.from("orders").select("*").eq("id", id).single();
  const bad = Object.entries(checks).filter(([k, want]) =>
    typeof want === "function" ? !want(data[k]) : data[k] !== want,
  );
  if (bad.length) {
    failures.push(`${label}: ${bad.map(([k]) => `${k}=${JSON.stringify(data[k])}`).join(", ")}`);
    console.log(`   ✗ ${label} — ${bad.map(([k]) => k).join(", ")}`);
  } else {
    console.log(`   ✓ ${label}`);
  }
  return data;
}

// --- pure-helper spot check: the "Copy times for lead" composition --------
// Cheap and DB-free: with the default schedule and an empty book, the offer
// must name a weekday, end with the closing question, and stay plain ASCII
// (it is destined for an SMS paste — GSM-7 or bust).
{
  const { openSlotSuggestions, suggestionText } = await import("../src/domain/booking.js");
  const from = new Date(Date.now() + 86400000);
  const text = suggestionText(openSlotSuggestions({ from, days: 2, perDay: 3 }));
  const dayText = suggestionText(openSlotSuggestions({ from, days: 1, perDay: 3 }));
  const ok =
    /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(text) &&
    text.endsWith("what time/day works for you?") &&
    // Single-day wording drops the "/day".
    dayText.endsWith("what time works for you?") &&
    /^[\x20-\x7E]+$/.test(text + dayText);
  console.log(ok ? "   ✓ lead-times text composes clean" : `   ✗ lead-times text: ${text}`);
  if (!ok) failures.push("openSlotSuggestions/suggestionText composed a bad offer");
}

const browser = await chromium.launch({ headless: HEADLESS, slowMo: SPEED / 4 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  // --- sign in -------------------------------------------------------------
  await signIn(page, "va", { base: BASE });
  await step(page, "Signing in", "as QA VA");

  // === 1. EDIT A MISTYPED MEETUP ==========================================
  const edit = await seed({
    name: "ZZ QA Typo Nmae",
    phone: "9805557101",
    // A condition per line, as the booking form now requires: the edit flow
    // re-validates the whole order and would otherwise refuse the name fix.
    items: [{ name: "iPhone 15", quantity: 1, price: 200, condition: "B" }],
    est_value: 200,
    pickup_date: dayAhead(1),
    pickup_time: "09:15",
  });
  await page.goto(`${BASE}/orders/${edit.id}`, { waitUntil: "domcontentloaded" });
  await step(page, "FLOW 1 — Edit", "The name was typed wrong. Fix it without retyping the order.");
  await page.getByRole("button", { name: /Edit details/i }).click();
  await page.waitForTimeout(SPEED);
  const nameField = page.getByRole("dialog").getByLabel("Customer name", { exact: false });
  await nameField.fill("");
  await nameField.pressSequentially("ZZ QA Fixed Name", { delay: 25 });
  await shot(page, "edit-form");
  await page.getByRole("button", { name: /Save changes/i }).click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(edit.id, { name: "ZZ QA Fixed Name" }, "name corrected");
  await shot(page, "edit-done");

  // === 2. RESCHEDULE THE APPOINTMENT ======================================
  await step(page, "FLOW 2 — Reschedule", "Customer wants a different day. Its own verb.");
  // The appointment collapsed to one line showing the time (2026-08-13);
  // the picker lives behind it, so open the row the way a person would.
  await page.locator("[data-appointment-toggle]").click();
  await page.waitForTimeout(SPEED);
  // The picker is the only input now: book by tapping a free slot, like a
  // person would. Candidates skip dayAhead(1) — the seeded appointment —
  // so the move is always a real move.
  const moved = await pickSlot(page, [2, 3, 4, 5, 6].map(dayAhead), "10:15 AM", {
    date: "#reschedule-date",
    time: "#reschedule-time",
  });
  await page.getByRole("button", { name: /Reschedule/i }).click();
  await page.waitForTimeout(SPEED);
  // The confirm previews the exact text the customer gets (test mode logs it).
  await shot(page, "reschedule-confirm");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Reschedule & text|Reschedule anyway/i })
    .click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(
    edit.id,
    { pickup_date: moved.date, pickup_time: (v) => String(v).startsWith(moved.time) },
    "appointment moved",
  );
  await shot(page, "reschedule-done");

  // === 3. CANCEL AN ORDER ==================================================
  await step(page, "FLOW 3 — Cancel", "Customer changed their mind. Needs a reason.");
  await page.getByRole("button", { name: /Cancel order/i }).click();
  await page.waitForTimeout(SPEED);
  await page
    .getByPlaceholder(/Reason/i)
    .pressSequentially("Customer changed their mind", { delay: 25 });
  await shot(page, "cancel-dialog");
  await page
    .getByRole("button", { name: /^Cancel order$/i })
    .last()
    .click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(
    edit.id,
    { status: "cancelled", cancel_reason: "Customer changed their mind" },
    "cancelled with reason",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await step(page, "FLOW 3 — Cancel", "Terminal, and out of the pipeline");
  await shot(page, "cancel-done");

  // === 4. NO-SHOW, THEN REBOOK ============================================
  const noshow = await seed({
    name: "ZZ QA NoShow",
    phone: "9805557102",
    items: [{ name: "iPhone 16", quantity: 1, price: 250, condition: "A" }],
    est_value: 250,
    pickup_date: dayAhead(0),
    pickup_time: "14:00",
  });
  await page.goto(`${BASE}/orders/${noshow.id}`, { waitUntil: "domcontentloaded" });
  await step(page, "FLOW 4 — No-show", "Nobody came. The only button used to be 'Mark bought'.");
  await page.getByRole("button", { name: /Didn't happen/i }).click();
  await page.waitForTimeout(SPEED);
  await page.getByRole("button", { name: /Didn't show up/i }).click();
  await page
    .getByPlaceholder(/Anything worth adding/i)
    .pressSequentially("Waited 20 minutes", { delay: 25 });
  await shot(page, "no-show-dialog");
  await page.getByRole("button", { name: /^Record$/i }).click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(
    noshow.id,
    { stop_outcome: "no_show", status: "awaiting" },
    "recorded, order still open for a rebook",
  );
  // A no-show announces: the rebook invitation must have been logged (test
  // mode writes the row without delivering). POLLED, because the action
  // writes the outcome patch before it sends — the patch landing first is
  // exactly what expectRow above saw, so one immediate query here races the
  // send and reports a text that was half a second from existing.
  let texted = false;
  for (let tries = 0; tries < 20 && !texted; tries++) {
    const msgs = await svc.from("messages").select("id").eq("order_id", noshow.id);
    texted = (msgs.data?.length ?? 0) > 0;
    if (!texted) await new Promise((r) => setTimeout(r, 300));
  }
  console.log(texted ? "   ✓ rebook text was logged" : "   ✗ no rebook text was logged");
  if (!texted) failures.push("no-show did not log the rebook text");

  await page.reload({ waitUntil: "domcontentloaded" });
  await step(page, "FLOW 4 — Rebook", "Same order, new slot — no second order created");
  // Fresh page load, so the appointment row starts collapsed again.
  await page.locator("[data-appointment-toggle]").click();
  await page.waitForTimeout(SPEED);
  // Candidates start past the seeded today-appointment so the rebook is a
  // real move; the schedule decides which day actually takes it.
  const rebooked = await pickSlot(page, [3, 4, 5, 6, 2, 1].map(dayAhead), "11:30 AM", {
    date: "#reschedule-date",
    time: "#reschedule-time",
  });
  await page.getByRole("button", { name: /Reschedule/i }).click();
  await page.waitForTimeout(SPEED);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Reschedule & text|Reschedule anyway/i })
    .click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(
    noshow.id,
    { pickup_date: rebooked.date, pickup_time: (v) => String(v).startsWith(rebooked.time) },
    "rebooked onto a fresh slot",
  );
  await shot(page, "rebooked");

  // === 5. WALK-IN WITH ITS PAYOUT =========================================
  // Through the real form, because the walk-in is the one order type whose
  // payout is part of intake — seeding it would skip the thing under test.
  await step(page, "FLOW 5 — Walk-in", "Already happened: paid at the counter, saved as paid");
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await page.getByLabel("Customer name", { exact: false }).fill("ZZ QA Walkin");
  await page.getByLabel("Phone", { exact: false }).fill("9805557105");
  const catalogSelect = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Add item from catalog" }) })
    .first();
  const values = (
    await catalogSelect.locator("option").evaluateAll((os) => os.map((o) => o.value))
  ).filter(Boolean);
  await catalogSelect.selectOption(values[0]);
  await page.waitForTimeout(400);
  await page.getByLabel("Price", { exact: false }).first().fill("120");
  // A one-off item that is NOT in the catalog rides along — priced at $0 so
  // the payout math below stays exactly the catalog item's $120.
  await page.getByRole("button", { name: "+ Custom item…" }).click();
  await page.getByLabel("Custom item name").fill("ZZ Custom Handheld");
  await page.getByLabel("Custom item name").press("Enter");
  // The payout amount defaults to the item total; Cash is the default method.
  await shot(page, "walkin-form");
  await page.getByRole("button", { name: /Create order/i }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30000 });
  const walkinId = page.url().split("/orders/")[1].split("?")[0];
  created.push(walkinId);
  await expectRow(
    walkinId,
    {
      walk_in: true,
      status: "paid",
      paid_amount: (v) => Number(v) === 120,
      payment_method: "Cash",
      // The custom (non-catalog) item landed in the items jsonb like any
      // catalog pick.
      items: (v) => JSON.stringify(v).includes("ZZ Custom Handheld"),
    },
    "walk-in saved paid, $120 cash, custom item aboard",
  );
  await shot(page, "walkin-created");

  // === 6. CORRECT THE PAYOUT ==============================================
  await step(page, "FLOW 6 — Correct a payout", "A typo in a payout used to be permanent");
  await page.getByRole("button", { name: /Correct this amount/i }).click();
  await page.waitForTimeout(SPEED);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByPlaceholder(/Why it changed/i)
    .pressSequentially("Agreed $110 after the recount", { delay: 25 });
  await dialog.locator('input[type="number"]').fill("110");
  await shot(page, "correct-payout");
  await dialog.getByRole("button", { name: /Save correction/i }).click();
  await page.waitForTimeout(SPEED * 3);
  await expectRow(walkinId, { paid_amount: (v) => Number(v) === 110 }, "payout corrected to $110");

  await page.reload({ waitUntil: "domcontentloaded" });
  await step(
    page,
    "DONE",
    `${failures.length ? failures.length + " problem(s)" : "all six flows passed"}`,
  );
  await shot(page, "final");
} catch (err) {
  console.error(`\nFAILED: ${err.message.split("\n")[0]}`);
  failures.push(err.message.split("\n")[0]);
  await shot(page, "FAILURE");
} finally {
  console.log(`\n${"=".repeat(60)}`);
  if (consoleErrors.length) {
    console.log("page errors:");
    for (const e of [...new Set(consoleErrors)].slice(0, 5)) console.log(`  ${e.slice(0, 140)}`);
  }
  console.log(failures.length ? `${failures.length} PROBLEM(S):` : "All checks passed.");
  for (const f of failures) console.log(`  - ${f}`);
  await page.waitForTimeout(HEADLESS ? 0 : 3000);
  await browser.close();
  for (const id of created) {
    await svc.from("messages").delete().eq("order_id", id);
    // A walk-in that got checked in would own lots (FK, no cascade on purpose).
    await svc.from("inventory_lots").delete().eq("order_id", id);
    await svc.from("orders").delete().eq("id", id);
  }
  console.log(`\nCleaned up ${created.length} test order(s). Screenshots in ${SHOTS}/`);
  process.exitCode = failures.length ? 1 : 0;
}
