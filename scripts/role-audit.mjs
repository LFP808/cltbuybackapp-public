/**
 * Every control every role can see, on every screen they can open.
 *
 *   node scripts/role-audit.mjs                  # the matrix
 *   node scripts/role-audit.mjs --role=va        # one role
 *   node scripts/role-audit.mjs --diff           # only where roles differ
 *
 * The QA sweep answers "does this route load for this role". This answers the
 * question that actually bites: does the page then OFFER them work the server
 * will refuse? That gap is invisible to a status-code check — a role once got
 * Reschedule, Edit details and Cancel order all rendered, and every one came
 * back "You can't do that."
 *
 * It reports rather than asserts, because "the VA sees Create invoice" is
 * only wrong once someone decides VAs should not. Read the matrix, decide,
 * then encode the decision as a check somewhere that fails.
 *
 * Needs the server and `npm run test-account`.
 */
import { chromium } from "playwright";
import { flag, has } from "./lib/args.mjs";
import { APP, ROLES, credentialsFor, signIn } from "./lib/app.mjs";

const BASE = APP;
const ONLY = flag("role", null);
const DIFF_ONLY = has("diff");

// Both roles there are: the owner and the VA.
const AUDIT_ROLES = ONLY ? [ONLY] : ROLES;

const ROUTES = [
  "/",
  "/customers",
  "/messages",
  "/calls",
  "/new",
  "/calendar",
  "/orders",
  "/inventory",
  "/inventory/check-in",
  "/inventory/labels",
  "/invoices",
  "/invoices/new",
  "/leads",
  "/expenses",
  "/pl",
  "/pricing",
  "/team",
  "/settings",
];

/** Labels that are navigation or chrome rather than an action on the page. */
const CHROME =
  /^(Dashboard|Customers|Messages|Calls|New Order|Calendar|Orders|Inventory|Invoices|Expenses|Money|Item Catalog|Team|Settings|Sign out|Menu|Close|Open|Today|Month|Week|Day|All|Meetup|Walk-in|Pending Check-in|Profit & loss|Cash flow|New|)$/;

const results = {};

const browser = await chromium.launch();
try {
  for (const role of AUDIT_ROLES) {
    credentialsFor(role);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await signIn(page, role, { base: BASE });
    results[role] = {};

    for (const route of ROUTES) {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const landed = new URL(page.url()).pathname;
      // Bounced by the role gate. Not a finding — that is the gate working.
      if (landed !== route) {
        results[role][route] = { blocked: true, landed };
        continue;
      }
      const controls = await page
        .getByRole("button")
        .evaluateAll((ns) =>
          ns
            .filter((n) => n.offsetParent !== null)
            .map((n) => n.textContent.replace(/\s+/g, " ").trim())
            .filter(Boolean),
        )
        .catch(() => []);
      results[role][route] = {
        status: res?.status(),
        controls: [...new Set(controls)].filter((c) => !CHROME.test(c)).sort(),
      };
    }
    await page.close();
  }
} finally {
  await browser.close();
}

// --- report ------------------------------------------------------------------
for (const route of ROUTES) {
  const perRole = AUDIT_ROLES.map((r) => [r, results[r]?.[route]]).filter(([, v]) => v);
  const open = perRole.filter(([, v]) => !v.blocked);
  if (!open.length) continue;

  const sets = open.map(([, v]) => v.controls.join("|"));
  const identical = sets.every((s) => s === sets[0]);
  if (DIFF_ONLY && identical) continue;

  console.log(`\n${route}`);
  for (const [role, v] of perRole) {
    if (v.blocked) {
      console.log(`  ${role.padEnd(8)} blocked -> ${v.landed}`);
      continue;
    }
    console.log(
      `  ${role.padEnd(8)} ${v.controls.length ? v.controls.join(", ") : "(no controls)"}`,
    );
  }
}

console.log("\n" + "=".repeat(60));
console.log("Controls a role can SEE. Cross-check against the role gate on the");
console.log("matching action — anything it will refuse should not be rendered.");
