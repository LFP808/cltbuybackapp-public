/**
 * The inventory + invoices lifecycle, end to end, in a real browser.
 *
 *   node scripts/inventory-demo.mjs               # headless, screenshots
 *   node scripts/inventory-demo.mjs --headed      # watch it
 *   node scripts/inventory-demo.mjs --keep        # don't delete test data
 *
 * Walks the whole design: a meetup order paid on the spot → checked in with a
 * split and a price haircut (so paid ≠ counted; one device gets an IMEI and
 * its own grade) → the grid and its tiles → an invoice built from stock →
 * settled per line, short on both (the "Settle — mark Settled" form) →
 * realized P/L → the printable document.
 *
 * Creates data named "ZZ Inv ..." and deletes all of it at the end (lots,
 * invoices, buyers, orders) unless --keep. Needs the server + QA logins.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { has } from "./lib/args.mjs";
import { APP, credentialsFor, signIn } from "./lib/app.mjs";

const BASE = APP;
const HEADLESS = !has("headed");
const KEEP = has("keep");
const SHOTS = "screenshots/inventory-demo";
const TAG = "ZZ Inv";
// A fixture-shaped IMEI for the split row. Typed, never looked up — Sickw's
// fill has its own coverage in the walkthrough; here the IMEI is data entry.
const IMEI = "356303481234578";

// ADMIN: the owner's end-to-end money story. (The VA can run every one of
// these screens too — ROUTE_ACCESS opens inventory and invoices to both —
// and qa-flows exercises the VA path.)
credentialsFor("admin");
mkdirSync(SHOTS, { recursive: true });

let shotNo = 0;
const errors = [];
const created = { orders: [], buyers: [] };

async function shot(page, name) {
  shotNo += 1;
  const file = join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`   📸 ${file}`);
}

function expect(cond, label) {
  if (cond) {
    console.log(`   ✓ ${label}`);
  } else {
    errors.push(label);
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
 * The first match that is actually on screen.
 *
 * The invoice builder renders its buyer card TWICE — once for narrow screens
 * and once in the desktop sidebar (`lg:hidden` / `hidden lg:block`) — so every
 * field in it matches two elements, and exactly one of them is visible at any
 * width. `.first()` is a coin flip that lands on the hidden copy at 1440px,
 * which is what made this demo stall on a select it could see in the DOM and
 * never click.
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

/**
 * The "On hand · COG" tile, as a number.
 *
 * Read rather than assumed: this demo shares a database with whatever is
 * already in stock, so the tile's absolute value is nobody's business but the
 * shelf's. What the demo can honestly assert is how much its own check-in
 * MOVED it.
 */
async function readOnHandCog(page) {
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  const grid = page.getByRole("button", { name: "Inventory", exact: true });
  if (await grid.isVisible().catch(() => false)) {
    await grid.click();
    await page.waitForTimeout(400);
  }
  const tile = page.locator("div", { hasText: /^On hand · COG$/ }).first();
  const value = await tile
    .locator("xpath=following-sibling::div[1]")
    .innerText()
    .catch(() => "0");
  return Number(String(value).replace(/[^0-9.]/g, "")) || 0;
}

/**
 * Remove EVERY "ZZ Inv" remnant, this run's or an earlier crashed one's.
 * Pattern-based on purpose: a leftover lot with this demo's exact item,
 * carrier, grade and COG would merge into the same pick-list group and
 * silently change the projected total the assertions are built on.
 */
async function sweep() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const del = (path) => fetch(`${url}/rest/v1/${path}`, { method: "DELETE", headers });
  const get = (path) =>
    fetch(`${url}/rest/v1/${path}`, { headers }).then((r) => r.json().catch(() => []));

  const orders = (await get(`orders?select=id&name=like.${encodeURIComponent(`${TAG}%`)}`)) || [];
  const orderIds = orders.map((o) => o.id);
  const buyers = (await get(`buyers?select=id&name=like.${encodeURIComponent(`${TAG}%`)}`)) || [];
  const buyerIds = buyers.map((b) => b.id);
  if (orderIds.length) {
    const list = `(${orderIds.join(",")})`;
    // FK order: lots point at orders and invoices; invoices at buyers.
    await del(`inventory_lots?order_id=in.${list}`);
    await del(`messages?order_id=in.${list}`);
  }
  if (buyerIds.length) {
    const ids = `(${buyerIds.join(",")})`;
    await del(`invoices?buyer_id=in.${ids}`);
    await del(`buyers?id=in.${ids}`);
  }
  if (orderIds.length) await del(`orders?id=in.(${orderIds.join(",")})`);
  return orderIds.length;
}

async function cleanup() {
  if (KEEP) return;
  await sweep();
  console.log("Cleaned up test data.");
}

const browser = await chromium.launch({ headless: HEADLESS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push(String(e)));

try {
  // A crashed earlier run leaves lots that would merge into this run's
  // pick-list groups and skew every money assertion — sweep first.
  const leftovers = await sweep();
  if (leftovers) console.log(`   (cleaned ${leftovers} leftover order(s) from an earlier run)`);

  await signIn(page, "admin", { base: BASE });

  // What is already on the shelf, so step 3 can assert this demo's own effect
  // on the tile rather than the shelf's total.
  const onHandBefore = await readOnHandCog(page);
  console.log(`   (shelf already holds $${onHandBefore.toFixed(2)} of COG)`);

  // === 1. A meetup order, paid on the spot =================================
  console.log("\n> 1. Meetup order — paid at the counter before any counting");
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Meetup", exact: true }).click();
  await page.getByLabel(/Customer name/i).fill(`${TAG} Meetup`);
  await page.getByLabel(/Phone/i).fill("9805558101");
  const select = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "Add item from catalog" }) })
    .first();
  const options = (
    await select
      .locator("option")
      .evaluateAll((os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })))
  ).filter((o) => o.value);
  // The item's NAME, kept for later. The grid and the invoice builder label
  // every row by item, and this demo shares a database with whatever else is
  // in stock — so from here on it addresses its own lots by name instead of
  // "the first checkbox on the page", which silently meant somebody else's
  // devices the moment the shelf was not empty.
  const ITEM = options[0].label;
  await select.selectOption(options[0].value);
  await page.waitForTimeout(300);
  await page.getByLabel("Price", { exact: false }).first().fill("75");
  await page.getByLabel("Quantity", { exact: false }).first().fill("3");
  await page.getByRole("button", { name: /Create order/i }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30000 });
  created.orders.push(page.url().split("/orders/")[1].split("?")[0]);

  // Stage buttons confirm through a dialog whose confirm button carries the
  // same (or the "Pay $X") label — two clicks per action, like a human.
  await page.getByRole("button", { name: /Mark bought/i }).click();
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: /Mark bought/i })
    .last()
    .click();
  await page.getByPlaceholder("Amount").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Amount").fill("225");
  await page.getByRole("button", { name: /Record payment/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Pay \$/i }).click();
  await page.getByText(/This order is complete/i).waitFor({ timeout: 15000 });
  expect(true, "meetup paid $225 on the spot");

  // === 2. Check-in with a split and a haircut ==============================
  console.log("\n> 2. Check-in — 2 grade A at $75, 1 grade B at $60 → counted $210 vs $225 paid");
  const orderId = created.orders[0];
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  expect(
    await page.getByText(`${TAG} Meetup`).first().isVisible(),
    "paid meetup queues for check-in",
  );
  await shot(page, "queue");
  await page
    .locator("tr", { hasText: `${TAG} Meetup` })
    .getByRole("link", { name: "Check in" })
    .click();
  await page.waitForURL(/\/inventory\/check-in\//, { timeout: 15000 });

  // Row 1: two identity-less units (sealed stock — no IMEI yet), grade A.
  await page.getByLabel("Quantity").first().fill("2");
  await page.getByLabel("Carrier").first().selectOption("Unlocked");
  await page.getByLabel("Grade").first().selectOption("A");
  // Row 2: the split — one device with its own IMEI, grade, and price.
  await page.getByRole("button", { name: /Split — another device/i }).click();
  await page.getByLabel("IMEI").nth(1).fill(IMEI);
  await page.getByLabel("Carrier").nth(1).selectOption("Unlocked");
  await page.getByLabel("Grade").nth(1).selectOption("B");
  await page.getByLabel("Price per unit").nth(1).fill("60");
  await shot(page, "checkin");
  await page.getByRole("button", { name: /Confirm check-in/i }).click();
  await page.waitForURL(new RegExp(`/orders/${orderId}`), { timeout: 15000 });
  await see(
    page.getByText(/Check-in counted \$210\.00/i),
    "order page flags $210 counted vs $225 paid",
  );
  await shot(page, "paid-gap");

  // === 3. The grid =========================================================
  console.log("\n> 3. Inventory grid — one row per device, IMEI and grade in the columns");
  const onHandCog = await readOnHandCog(page);
  await see(page.getByText(IMEI), "the split device shows under its IMEI");
  expect(await page.getByText("On hand · COG").isVisible(), "tiles render");
  // The on-hand tile is the WHOLE shelf, so it only equals this demo's $210 on
  // an empty database. Asserted as the increase the check-in caused, measured
  // against the same tile before it — the demo's own contribution, whatever
  // else happens to be in stock.
  expect(
    Math.abs(onHandCog - onHandBefore - 210) < 0.005,
    `on-hand COG rose by $210.00 (${onHandBefore.toFixed(2)} -> ${onHandCog.toFixed(2)})`,
  );
  await shot(page, "grid");

  // === 4. Invoice from stock ===============================================
  console.log("\n> 4. Invoice — both lines to a new buyer, projected $250");
  await page.goto(`${BASE}/invoices/new`, { waitUntil: "networkidle" });
  // ONLY this demo's rows, addressed by their full accessible names — the
  // pick list keys groups on item + carrier + grade, and that trio is exactly
  // what the labels carry.
  const lineA = `${ITEM}, Unlocked, grade A`;
  const lineB = `${ITEM}, Unlocked, grade B`;
  await page.getByRole("checkbox", { name: `Pick ${lineA}`, exact: true }).check();
  await page.getByRole("checkbox", { name: `Pick ${lineB}`, exact: true }).check();
  await page.locator(`input[aria-label="Invoice price per unit for ${lineA}"]`).fill("95"); // 2 → 190
  await page.locator(`input[aria-label="Invoice price per unit for ${lineB}"]`).fill("60"); // 1 → 60
  // Every field below lives in the buyer card, which the builder renders twice
  // for the two breakpoints — so each one is addressed by the copy that is
  // actually on screen. See onScreen().
  await (await onScreen(page.getByLabel(/Buyer/i), "buyer select")).selectOption("__new__");
  await (
    await onScreen(page.getByLabel("Name", { exact: true }), "buyer name")
  ).fill(`${TAG} Buyer`);
  created.buyers.push(`${TAG} Buyer`);
  await (
    await onScreen(page.getByLabel(/Terms/i), "terms")
  ).fill("ACH Information\nAccount # - 000\nRouting # - 000");
  await (await onScreen(page.getByLabel(/Shipping/i), "shipping")).fill("10");
  await shot(page, "builder");
  await page.getByRole("button", { name: /Create invoice/i }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 });
  await see(page.getByText("Sent", { exact: true }), "invoice created as Sent");
  await see(page.getByText("$250.00"), "projected $250.00");

  // === 4b. The pick sheet ==================================================
  // Between "invoice exists" and "money moves" there is a physical job: go and
  // get the devices. Asserted here because it is only reachable while sent.
  console.log("\n> 4b. Pick sheet — 3 devices, oldest first, checked off");
  const invoicePage = page.url();
  await page.getByRole("link", { name: /Pick devices/i }).click();
  await page.waitForURL(/\/pick$/, { timeout: 15000 });
  await see(page.getByText(/oldest stock first/i), "list states its order");
  await see(page.getByText(/0 of 3 pulled/i), "progress starts empty");
  const rows = page.getByRole("button", { pressed: false }).filter({ hasText: ITEM });
  const rowCount = await rows.count();
  expect(rowCount === 3, `pick list has one row per physical device (found ${rowCount})`);
  for (let i = 0; i < rowCount; i++) await rows.nth(0).click();
  await see(page.getByText(/3 of 3 pulled/i), "every device checked off");
  await see(page.getByText(/All pulled — done/i), "footer confirms the pick is complete");
  // The progress bar animates. Machine-speed clicks land inside one paint, so a
  // screenshot taken immediately catches the transition at its start and the bar
  // looks empty next to "3 of 3" — a demo artifact that reads as a bug.
  await page.waitForTimeout(400);
  expect(
    (await page.locator('[role="progressbar"]').getAttribute("aria-valuenow")) === "3",
    "progress bar reports all 3 pulled",
  );
  await shot(page, "pick");
  await page.goto(invoicePage, { waitUntil: "networkidle" });

  // === 5. Settle per line — short on both ==================================
  console.log("\n> 5. Settle — A at $90/ea, B at $40: $220 in, P/L = 220−10−210 = $0");
  await page
    .locator(`input[aria-label="Actual sold price per unit for ${lineA}"]`)
    .fill("90"); // ×2 = 180
  await page
    .locator(`input[aria-label="Actual sold price per unit for ${lineB}, IMEI ${IMEI}"]`)
    .fill("40"); // ×1 = 40
  await page.waitForTimeout(400);
  await see(
    page.getByText(/Under the asking total by/i),
    "settle form flags the $30 shortfall vs ask",
  );
  await see(page.getByText(/Settling locks P\/L at/i), "P/L preview shows before anything writes");
  await shot(page, "settle-preview");
  await page.getByRole("button", { name: /Settle — mark Settled/ }).click();
  await see(
    page.getByText(/Asked \$250\.00 → paid \$220\.00/),
    "invoice Settled: asked $250 → paid $220",
  );
  await shot(page, "settled");

  // === 6. The printable document ===========================================
  console.log("\n> 6. Print view — the paper invoice from the record");
  const invoiceUrl = page.url();
  await page.goto(`${invoiceUrl}/print`, { waitUntil: "networkidle" });
  await see(page.getByText("INVOICE", { exact: true }), "print document renders");
  await see(page.getByText(/ACH Information/i), "buyer terms print");
  await shot(page, "print");

  // === 7. Grid shows the money trail; customer page shows the history ======
  await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  // Scoped to the demo's own IMEI row — "Sold" is also a stat-tile label, and
  // asserting it bare would pass on any database.
  await see(
    page.locator("tr", { hasText: IMEI }).getByText("Sold", { exact: true }),
    "the demo's device reads Sold in the grid",
  );
  await shot(page, "grid-complete");

  await page.goto(`${BASE}/customers/9805558101`, { waitUntil: "networkidle" });
  await see(
    page.getByText(/Devices from this customer/i),
    "customer page shows the devices section",
  );
  await shot(page, "customer");

  console.log(errors.length ? `\n${errors.length} FAILURE(S)` : "\nAll checks passed.");
} finally {
  await browser.close();
  await cleanup();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
