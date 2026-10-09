/**
 * A visible, human-paced walkthrough of both order lifecycles, end to end.
 *
 *   npm run walkthrough                  # watch it in a real browser window
 *   npm run walkthrough -- --speed=800   # slower, for demoing to someone
 *   npm run walkthrough -- --headless    # just the screenshots
 *   npm run walkthrough -- --keep        # don't delete the test data
 *
 * ACT 1 — BOOKED MEETUP: created at /new, confirmed on the calendar, marked
 * bought, paid, checked in by IMEI (Sickw fills the device's real name and
 * carrier), and seen in the inventory grid.
 *
 * ACT 2 — WALK-IN: created already-paid with its counter payout, checked in,
 * invoiced with per-line rates, exported for the buyer, and settled per line
 * with one line adjusted — then the database is asked whether the money facts
 * landed exactly as typed.
 *
 * This is a demo you can watch, but it ASSERTS: every money step is checked
 * against the database with the service key, and a failed check fails the run.
 *
 * It creates data named "ZZ Test ..." and deletes all of it at the end,
 * including after a failure. Needs the server on PORT (default 3000) and the
 * QA logins from `npm run test-account`. Sickw must be in test mode (no
 * SICKW_API_KEY, or SICKW_TEST_MODE=1) — the IMEIs below are fixture IMEIs.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flag, has } from "./lib/args.mjs";
import { APP, credentialsFor, signIn } from "./lib/app.mjs";

const BASE = APP;
const SPEED = Number(flag("speed", 450));
const HEADLESS = has("headless");
const KEEP = has("keep");
const SHOTS = "screenshots/walkthrough";
const TAG = "ZZ Test";

// Fixture IMEIs (see src/lib/sickw/fixtures.js): the last digit picks the
// canned device. ...0 answers a clean unlocked iPhone 15 Pro Max; ...2 an
// AT&T-locked iPhone 16.
const IMEI_CLEAN = "356303481234560";
const IMEI_ATT = "359218771234562";

// Checked before the browser launches: a missing login is worth knowing about
// in the first second, not after Chromium has started and navigated.
credentialsFor("admin");
mkdirSync(SHOTS, { recursive: true });

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let shotNo = 0;
const created = [];
const pageErrors = [];
const failures = [];

function expect(cond, label) {
  if (cond) {
    console.log(`   ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`   ✗ FAILED: ${label}`);
  }
}

/** Assert by WAITING — pages stream in behind loading boundaries, so a
 *  same-tick isVisible() judges the spinner, not the page. */
async function see(locator, label, timeout = 12000) {
  const ok = await locator
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
  expect(ok, label);
}

/**
 * Caption the current step on the page itself.
 *
 * Injected into the document rather than logged to the terminal, which is what
 * puts it in the screenshots — where it does the most good. Navigation wipes
 * it, so every step re-injects.
 */
async function step(page, title, detail = "") {
  console.log(`\n> ${title}${detail ? ` - ${detail}` : ""}`);
  await page
    .evaluate(
      ([t, d]) => {
        document.getElementById("wt-banner")?.remove();
        const el = document.createElement("div");
        el.id = "wt-banner";
        el.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;" +
          "background:#16181d;" +
          "color:#fff;font:600 14px/1.5 system-ui,sans-serif;padding:13px 20px;" +
          "display:flex;gap:12px;align-items:baseline";
        el.innerHTML =
          `<span style="color:#9cc0f4;white-space:nowrap">${t}</span>` +
          (d ? `<span style="opacity:.8;font-weight:400">${d}</span>` : "");
        document.body.appendChild(el);
      },
      [title, detail],
    )
    .catch(() => {});
  await page.waitForTimeout(SPEED);
}

async function shot(page, name) {
  const file = join(SHOTS, `${String(++shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  [shot] ${file}`);
}

/** Fill a labelled field at typing speed, so it reads as a person working. */
async function type(page, label, value) {
  const field = page.getByLabel(label, { exact: false }).first();
  await field.click();
  await field.fill("");
  await field.pressSequentially(value, { delay: 20 });
}

/**
 * Book through the slot picker the way a person does — since the 2026-08-13
 * rebuild it is the ONLY input (the native date/time fields are hidden
 * carriers): tap a day on the strip, then a time chip. The admin-set
 * schedule rules what exists: a closed day falls through to the next
 * candidate and a missing time falls back to the day's first free chip, so
 * the run books what a person could book. Returns {date, time} read back
 * from the hidden fields, so callers assert what the UI really did.
 */
async function pickSlot(
  page,
  dates,
  timeLabel,
  ids = { date: "#pickupDate", time: "#pickupTime" },
) {
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

/**
 * Add a named catalog item, give it a condition, and price it in the /new
 * items editor. The condition is required on a booking (2026-10-02) and
 * harmless on a walk-in, so every added line gets one: the first real rung
 * of the ladder, whatever the admin named it.
 */
async function addItem(page, name, price) {
  const select = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Add item from catalog" }) })
    .first();
  await select.selectOption(name);
  await page.waitForTimeout(300);
  await page.getByLabel(`Condition for ${name}`).last().selectOption({ index: 1 });
  await page.getByLabel("Price", { exact: false }).last().fill(String(price));
}

/** Submit the form and remember the order we land on, so we can clean it up. */
async function submitOrder(page) {
  await page.getByRole("button", { name: /Create order/i }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30000 });
  const id = page.url().split("/orders/")[1].split("?")[0];
  created.push(id);
  return id;
}

/**
 * Click an action button, then through the confirmation dialog it opens.
 *
 * Stage and money buttons confirm first — for a meetup handover the dialog's
 * whole point is saying "no text will be sent" — and the confirm button
 * inside carries the same label (or `confirm`, when it differs: "Record
 * payment" confirms with "Pay $X").
 */
async function act(page, name, confirm = name) {
  await page.getByRole("button", { name }).first().click();
  const dialog = page.getByRole("dialog");
  const confirmed = await dialog
    .waitFor({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (confirmed) await dialog.getByRole("button", { name: confirm }).last().click();
  await page.waitForTimeout(SPEED * 2.5);
}

/**
 * The first match that is actually on screen.
 *
 * The invoice builder renders its buyer card TWICE — once for narrow screens
 * and once in the desktop rail (`lg:hidden` / `hidden lg:block`) — so every
 * field in it matches two elements, and exactly one is visible at any width.
 */
async function onScreen(locator, label = "element") {
  // Polls briefly: the element this is asked for is usually one React render
  // behind the click that revealed it.
  const deadline = Date.now() + 4000;
  let n = 0;
  do {
    n = await locator.count();
    for (let i = 0; i < n; i++) {
      if (await locator.nth(i).isVisible()) return locator.nth(i);
    }
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() < deadline);
  throw new Error(`no visible ${label} (${n} in the DOM)`);
}

/** The accessible-name suffix the invoice screens use for a lot's line. */
function lineLabel(lot) {
  return `${lot.item}, ${lot.carrier || "any carrier"}, grade ${lot.grade || "?"}`;
}

/**
 * Remove every remnant of a previous run FIRST: a leftover open order on the
 * same phone trips the duplicate refusal and derails the create step.
 */
async function preClean() {
  const { data: old } = await svc.from("orders").select("id").like("name", `${TAG}%`);
  const ids = (old || []).map((o) => o.id);
  const { data: buyers } = await svc.from("buyers").select("id").like("name", `${TAG}%`);
  const buyerIds = (buyers || []).map((b) => b.id);
  // FK order: lots point at orders and invoices; invoices at buyers.
  if (ids.length) {
    await svc.from("inventory_lots").delete().in("order_id", ids);
    await svc.from("messages").delete().in("order_id", ids);
  }
  if (buyerIds.length) {
    await svc.from("invoices").delete().in("buyer_id", buyerIds);
    await svc.from("buyers").delete().in("id", buyerIds);
  }
  if (ids.length) await svc.from("orders").delete().in("id", ids);
  return ids.length;
}

async function cleanup() {
  await preClean();
  console.log(`Cleaned up ${created.length} test order(s).`);
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch({ headless: HEADLESS, slowMo: SPEED / 3 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  const leftovers = await preClean();
  if (leftovers) console.log(`(cleaned ${leftovers} leftover order(s) from an earlier run)`);
  await signIn(page, "admin", { base: BASE });

  // === ACT 1 — BOOKED MEETUP ===============================================
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
  await step(page, "MEETUP 1/6", "Customer books a visit to our office");
  await page.getByRole("button", { name: "Meetup", exact: true }).click();
  await type(page, "Customer name", `${TAG} Meetup`);
  await type(page, "Phone", "9805557001");
  await addItem(page, "iPhone 15 Pro Max", 300);
  // Tomorrow is always on the picker's first page (the day strip is a
  // rolling 7-day window starting today), but its HOURS are the admin's —
  // so aim for tomorrow 9:45 AM and let pickSlot degrade to whatever the
  // schedule actually offers.
  const laterDays = [1, 2, 3, 4, 5, 6].map((n) =>
    new Date(Date.now() + n * 86400000).toISOString().slice(0, 10),
  );
  await pickSlot(page, laterDays, "9:45 AM");
  await shot(page, "meetup-form");

  const meetupId = await submitOrder(page);
  await step(page, "MEETUP 2/6", "Booked - the confirmation text names the time and our address");
  await shot(page, "meetup-created");

  // The appointment on the calendar. Month view first; tomorrow can fall off
  // the month grid at a month boundary, and the Week agenda catches it there.
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  let onCalendar = await page
    .getByText(`${TAG} Meetup`)
    .first()
    .isVisible()
    .catch(() => false);
  if (!onCalendar) {
    await page.getByRole("button", { name: /Week/ }).click();
    await page.waitForTimeout(600);
    onCalendar = await page
      .getByText(`${TAG} Meetup`)
      .first()
      .isVisible()
      .catch(() => false);
  }
  expect(onCalendar, "booked meetup appears on the calendar");
  await step(page, "MEETUP 3/6", "Tomorrow's slot is on the calendar");
  await shot(page, "meetup-calendar");

  // The handover. The dialog says no text will be sent — a person at the
  // counter just said it out loud.
  await page.goto(`${BASE}/orders/${meetupId}`, { waitUntil: "networkidle" });
  await step(
    page,
    "MEETUP 4/6",
    "They showed up - Mark bought confirms with 'no text will be sent'",
  );
  await act(page, /Mark bought/i);
  await page.getByPlaceholder("Amount").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Amount").fill("300");
  await act(page, /Record payment/i, /^Pay \$/i);
  await see(page.getByText(/This order is complete/i), "meetup paid $300 at the counter");
  await shot(page, "meetup-paid");

  // Check-in: the IMEI is the device's identity, and Sickw is the one who
  // actually knows what it is.
  await step(page, "MEETUP 5/6", "Counting the device in - Sickw looks the IMEI up");
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page
    .locator("tr", { hasText: `${TAG} Meetup` })
    .getByRole("link", { name: "Check in" })
    .click();
  await page.waitForURL(/\/inventory\/check-in\//, { timeout: 15000 });

  await page.getByLabel("IMEI").first().fill(IMEI_CLEAN);
  await page.getByRole("button", { name: "Look up", exact: true }).first().click();
  // The fixture answers a clean unlocked iPhone 15 Pro Max; the form fills the
  // item's real name and maps the carrier verdict onto the fixed list.
  await see(
    page.getByText("iPhone 15 Pro Max 256GB Natural Titanium"),
    "Sickw fill renamed the row to the device's real identity",
  );
  await see(page.getByText(/FMI OFF/i), "buying facts strip shows FMI");
  expect(
    (await page.getByLabel("Carrier").first().inputValue()) === "Unlocked",
    "Sickw fill set the carrier to Unlocked",
  );
  await page.getByLabel("Grade").first().selectOption("A");
  await shot(page, "meetup-checkin");
  await page.getByRole("button", { name: /Confirm check-in/i }).click();
  await page.waitForURL(new RegExp(`/orders/${meetupId}`), { timeout: 15000 });

  // The database is the truth the screen was narrating.
  {
    const { data: lots } = await svc.from("inventory_lots").select("*").eq("order_id", meetupId);
    expect(lots?.length === 1, `check-in made exactly one lot (found ${lots?.length ?? 0})`);
    const lot = lots?.[0] || {};
    expect(lot.imei === IMEI_CLEAN, "lot carries the scanned IMEI");
    expect(lot.serial === "FFWX2Q9KL0", "lot carries the serial Sickw reported");
    expect(lot.carrier === "Unlocked", "lot carries the carrier");
    expect(lot.grade === "A", "lot carries the grade");
    expect(Number(lot.cog) === 300 && lot.quantity === 1, "lot is one device at $300 COG");
    expect(lot.status === "in_stock", "lot landed in stock");
    const { data: ord } = await svc
      .from("orders")
      .select("checked_in_at")
      .eq("id", meetupId)
      .single();
    expect(Boolean(ord?.checked_in_at), "order is stamped checked-in");
  }

  await step(page, "MEETUP 6/6", "The device is on the shelf, IMEI and all");
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await see(page.getByText(IMEI_CLEAN), "grid shows the device by IMEI");
  await shot(page, "meetup-grid");

  // === ACT 2 — WALK-IN =====================================================
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
  await step(page, "WALK-IN 1/5", "No appointment - they're at the counter, money moves now");
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await type(page, "Customer name", `${TAG} Walkin`);
  await type(page, "Phone", "9805557002");
  await addItem(page, "iPhone 16", 250);
  await addItem(page, "AirPods Pro", 90);
  // The payout card defaults to the item total ($340) and Cash — leave both.
  await shot(page, "walkin-form");

  const walkinId = await submitOrder(page);
  await step(page, "WALK-IN 2/5", "Saved as paid - no text, no calendar entry");
  {
    const { data: ord } = await svc.from("orders").select("*").eq("id", walkinId).single();
    expect(ord?.walk_in === true && ord?.status === "paid", "walk-in saved already paid");
    expect(Number(ord?.paid_amount) === 340, "payout recorded at the $340 item total");
    expect(ord?.payment_method === "Cash", "paid in cash by default at the counter");
    expect(ord?.pickup_date == null, "no appointment date - it already happened");
  }
  await shot(page, "walkin-created");

  await step(page, "WALK-IN 3/5", "Check-in audits the buy - one row per device");
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page
    .locator("tr", { hasText: `${TAG} Walkin` })
    .getByRole("link", { name: "Check in" })
    .click();
  await page.waitForURL(/\/inventory\/check-in\//, { timeout: 15000 });
  // First card is the iPhone (order line order). Its IMEI ends in 2 — the
  // AT&T-locked fixture — so the carrier fill has something to prove.
  await page.getByLabel("IMEI").first().fill(IMEI_ATT);
  await page.getByRole("button", { name: "Look up", exact: true }).first().click();
  await see(page.getByText(/iPhone 16 128GB Black/), "Sickw renamed the walk-in phone");
  expect(
    (await page.getByLabel("Carrier").first().inputValue()) === "AT&T",
    "locked-to-AT&T verdict mapped onto the carrier list",
  );
  // The AirPods row has no IMEI to scan — an identity-less unit is allowed.
  await shot(page, "walkin-checkin");
  await page.getByRole("button", { name: /Confirm check-in/i }).click();
  await page.waitForURL(new RegExp(`/orders/${walkinId}`), { timeout: 15000 });

  const { data: walkinLots } = await svc
    .from("inventory_lots")
    .select("*")
    .eq("order_id", walkinId)
    .order("created_at");
  expect(walkinLots?.length === 2, `two devices in stock (found ${walkinLots?.length ?? 0})`);
  const phoneLot = (walkinLots || []).find((l) => l.imei === IMEI_ATT);
  const podsLot = (walkinLots || []).find((l) => l.item === "AirPods Pro");
  expect(Boolean(phoneLot), "the phone lot carries its IMEI");
  expect(Boolean(podsLot), "the AirPods lot exists without one");

  // The invoice: pick this walk-in's two lines, price them, send it.
  await step(page, "WALK-IN 4/5", "Invoice - per-line asking rates, then the buyer export");
  await page.goto(`${BASE}/invoices/new`, { waitUntil: "networkidle" });
  await page.getByRole("checkbox", { name: `Pick ${lineLabel(phoneLot)}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Pick ${lineLabel(podsLot)}`, exact: true }).check();
  await page
    .locator(`input[aria-label="Invoice price per unit for ${lineLabel(phoneLot)}"]`)
    .fill("300");
  await page
    .locator(`input[aria-label="Invoice price per unit for ${lineLabel(podsLot)}"]`)
    .fill("110");
  await (await onScreen(page.getByLabel(/Buyer/i), "buyer select")).selectOption("__new__");
  await (
    await onScreen(page.getByLabel("Name", { exact: true }), "buyer name")
  ).fill(`${TAG} Buyer`);
  await (
    await onScreen(page.getByLabel(/Terms/i), "terms")
  ).fill("ACH Information\nAccount # - 000\nRouting # - 000");
  await (await onScreen(page.getByLabel(/Shipping/i), "shipping")).fill("10");
  await shot(page, "invoice-builder");
  await page.getByRole("button", { name: /Create invoice/i }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 });
  await see(page.getByText("Sent", { exact: true }), "invoice created as Sent");
  await see(page.getByText("$410.00"), "projected $410.00 (300 + 110)");
  const invoiceId = page.url().split("/invoices/")[1];

  // The buyer export IS the negotiation sheet: shared-sheet columns, one row
  // per device, asking prices while the invoice is still Sent.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export for buyer/i }).click(),
  ]);
  const csvPath = await download.path();
  const csv = readFileSync(csvPath, "utf8");
  expect(
    csv.split("\n")[0].replace(/"/g, "") === "IMEI,Items,Carrier,Grade,Price Sold",
    "buyer CSV carries the shared-sheet columns",
  );
  expect(csv.includes(IMEI_ATT), "buyer CSV lists the phone by IMEI");
  expect(csv.includes("AirPods Pro"), "buyer CSV lists the identity-less line");
  await shot(page, "invoice-sent");

  // Settle per line: the sheet came back with the phone knocked down $20.
  await step(page, "WALK-IN 5/5", "Settle - actuals per line, one line adjusted");
  await page
    .locator(
      `input[aria-label="Actual sold price per unit for ${lineLabel(phoneLot)}, IMEI ${IMEI_ATT}"]`,
    )
    .fill("280");
  // The AirPods line keeps its prefilled asking price ($110).
  await shot(page, "settle-form");
  await page.getByRole("button", { name: /Settle — mark Settled/ }).click();
  await see(page.getByText("Settled", { exact: true }), "invoice reads Settled");
  await see(
    page.getByText(/Asked \$410\.00 → paid \$390\.00/),
    "header reconciles asked vs paid (280 + 110)",
  );
  await shot(page, "settled");

  // The one assertion the whole act builds to: the per-line actual landed on
  // the exact device, to the cent, in the database.
  {
    const { data: inv } = await svc.from("invoices").select("*").eq("id", invoiceId).single();
    expect(inv?.status === "complete", "invoice row is complete (Settled)");
    expect(Number(inv?.paid) === 390, "invoice paid = $390, the sum of the actuals");
    const { data: after } = await svc.from("inventory_lots").select("*").eq("order_id", walkinId);
    const phoneAfter = (after || []).find((l) => l.imei === IMEI_ATT);
    const podsAfter = (after || []).find((l) => l.item === "AirPods Pro");
    expect(Number(phoneAfter?.sold_total) === 280, "phone sold_total is the adjusted $280");
    expect(Number(podsAfter?.sold_total) === 110, "AirPods sold_total kept the $110 ask");
    expect(
      phoneAfter?.status === "complete" && podsAfter?.status === "complete",
      "both lots settled with the invoice",
    );
  }

  await step(
    page,
    "DONE",
    failures.length ? `${failures.length} problem(s)` : "both lifecycles verified against the DB",
  );
  await shot(page, "final");
  console.log(
    `\n${failures.length ? failures.length + " FAILURE(S)" : "All checks passed."} ${shotNo} screenshots in ${SHOTS}/`,
  );
} catch (err) {
  console.error(`\nFAILED: ${err.message.split("\n")[0]}`);
  failures.push(err.message.split("\n")[0]);
  await shot(page, "FAILURE").catch(() => {});
} finally {
  if (pageErrors.length) {
    console.log(`\n${pageErrors.length} page error(s):`);
    for (const e of [...new Set(pageErrors)].slice(0, 6)) console.log(`  ${e.slice(0, 160)}`);
  }
  await page.waitForTimeout(HEADLESS ? 0 : 2500);
  await browser.close();
  if (KEEP) console.log(`Kept: ${created.join(", ")}`);
  else await cleanup();
  if (failures.length) {
    console.error(failures.map((f) => ` - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}
