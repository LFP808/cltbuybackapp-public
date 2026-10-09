/**
 * Sweep every route as every role and report what breaks.
 *
 *   npm run qa                        # headless, all roles, desktop + mobile
 *   npm run qa -- --headed --speed=1000   # watch it, a second per page
 *   npm run qa -- --role=va
 *   npm run qa -- --desktop-only
 *
 * For each page it records: where it actually landed (so a role gate that
 * redirects is visible), the document status, console and page errors, failed
 * network requests, and horizontal overflow. Screenshots go to screenshots/qa.
 *
 * The point is COVERAGE, not assertions — it opens everything once and reports
 * anything a user would see. The one thing it does assert is the role gate:
 * ROUTE_ACCESS denies a VA the money screens, so a VA landing ON one (or an
 * admin bounced OFF one) is recorded as an error, not left to a person to
 * notice in a redirect column.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flag, has } from "./lib/args.mjs";
import { APP, ROLES, signIn } from "./lib/app.mjs";

const OUT = "screenshots/qa";
const desktopOnly = has("desktop-only");
const onlyRole = flag("role", null);
// Watchable mode: a real window, and a pause on each page long enough to read
// it. Off by default because the point of the sweep is coverage, not theatre.
const headed = has("headed");
const SPEED = Number(flag("speed", 0));

mkdirSync(OUT, { recursive: true });

const VIEWPORTS = desktopOnly
  ? [{ name: "desktop", width: 1440, height: 900 }]
  : [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ];

const roles = ROLES.filter((r) => !onlyRole || r === onlyRole);

/**
 * Mirrors domain/access.js ROUTE_ACCESS: the paths a VA is denied. Kept as a
 * list here (rather than importing the domain module) because this script runs
 * outside the Next build and the whole point is to verify the DEPLOYED gate
 * against an independent copy of the expectation.
 */
const ADMIN_ONLY = ["/expenses", "/pl", "/pricing", "/team", "/settings"];
const adminOnly = (path) => ADMIN_ONLY.some((p) => path === p || path.startsWith(`${p}/`));

/** Pull real ids so detail pages are exercised with real data, not 404s. */
async function fixtures() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (q) => (await fetch(`${url}/rest/v1/${q}`, { headers: h })).json();

  const [orders, walkIn, meetup, notes] = await Promise.all([
    get("orders?select=id,phone&order=created_at.desc&limit=1"),
    get("orders?select=id&walk_in=eq.true&order=created_at.desc&limit=1"),
    get("orders?select=id&walk_in=eq.false&order=created_at.desc&limit=1"),
    get("contact_notes?select=phone&limit=1"),
  ]);
  return {
    walkInId: walkIn[0]?.id || null,
    meetupId: meetup[0]?.id || null,
    phone: orders[0]?.phone || notes[0]?.phone || null,
  };
}

const fx = await fixtures();

/** Every clean URL the app serves. */
const ROUTES = [
  { path: "/", name: "dashboard" },
  { path: "/?view=overview", name: "overview" },
  { path: "/customers", name: "customers" },
  fx.phone && { path: `/customers/${fx.phone}`, name: "customer-detail" },
  { path: "/messages", name: "messages" },
  fx.phone && { path: `/messages?phone=${fx.phone}`, name: "messages-deeplink" },
  { path: "/calls", name: "calls" },
  { path: "/new", name: "new-order" },
  { path: "/calendar", name: "calendar" },
  fx.meetupId && { path: `/orders/${fx.meetupId}`, name: "order-meetup" },
  fx.walkInId && { path: `/orders/${fx.walkInId}`, name: "order-walkin" },
  { path: "/orders", name: "orders-list" },
  { path: "/inventory", name: "inventory" },
  { path: "/inventory/check-in", name: "check-in-queue" },
  // No ids: the empty state. The real sheet needs lot ids from the grid.
  { path: "/inventory/labels", name: "labels" },
  { path: "/invoices", name: "invoices" },
  { path: "/invoices/new", name: "invoice-new" },
  { path: "/leads", name: "leads" },
  // The money screens — admin-only per ROUTE_ACCESS, and the sweep asserts
  // the gate below rather than just photographing the redirect.
  { path: "/expenses", name: "expenses" },
  { path: "/pl", name: "money" },
  { path: "/pricing", name: "pricing" },
  { path: "/team", name: "team" },
  { path: "/settings", name: "settings" },
  { path: "/nope-does-not-exist", name: "unknown-route" },
].filter(Boolean);

const findings = [];
const record = (f) => {
  findings.push(f);
  console.log(
    `  ${f.severity === "error" ? "✗" : "!"} [${f.role}/${f.view}] ${f.page}: ${f.detail}`,
  );
};

const browser = await chromium.launch({ headless: !headed, slowMo: headed ? SPEED / 6 : 0 });

for (const role of roles) {
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${role} / ${vp.name} ===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await context.newPage();

    // Collected per page, reset before each navigation.
    let consoleErrors = [];
    let pageErrors = [];
    let badRequests = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().includes("favicon")) {
        badRequests.push(`${r.status()} ${r.url().replace(APP, "")}`);
      }
    });

    // --- sign in ------------------------------------------------------------
    // The reason is reported, not just the failure: "no credentials, run
    // test-account" and "wrong password" send you to different places, and
    // this used to say only "sign-in never left /login" for both.
    let landed;
    try {
      landed = await signIn(page, role);
    } catch (err) {
      record({
        role,
        view: vp.name,
        page: "login",
        severity: "error",
        detail: err.message,
      });
      await context.close();
      continue;
    }
    console.log(`  signed in -> ${landed}`);

    // --- every route --------------------------------------------------------
    for (const route of ROUTES) {
      consoleErrors = [];
      pageErrors = [];
      badRequests = [];

      let status = null;
      try {
        const res = await page.goto(`${APP}${route.path}`, {
          waitUntil: "networkidle",
          timeout: 25000,
        });
        status = res?.status() ?? null;
      } catch (err) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "error",
          detail: `navigation failed: ${err.message.split("\n")[0]}`,
        });
        continue;
      }
      await page.waitForTimeout(400);

      const finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
      const redirected = finalPath !== route.path;

      // THE ROLE GATE, asserted both ways. A VA who lands on a money screen is
      // the gate broken open; an admin bounced off one is the gate broken shut.
      const cleanPath = route.path.split("?")[0];
      if (adminOnly(cleanPath)) {
        if (role === "va" && !redirected) {
          record({
            role,
            view: vp.name,
            page: route.name,
            severity: "error",
            detail: `role gate failed: a VA opened ${cleanPath}`,
          });
        }
        if (role === "admin" && redirected) {
          record({
            role,
            view: vp.name,
            page: route.name,
            severity: "error",
            detail: `role gate failed: admin was bounced to ${finalPath}`,
          });
        }
      }

      // Horizontal overflow — the classic mobile break.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      // Visible crash text, as opposed to a silent console error.
      const crashed = await page.evaluate(() => {
        const t = document.body.innerText || "";
        return /Application error|Unhandled Runtime Error|something went wrong/i.test(t);
      });

      if (SPEED > 0) {
        await page
          .evaluate(
            ([r, v, n, p]) => {
              document.getElementById("qa-banner")?.remove();
              const el = document.createElement("div");
              el.id = "qa-banner";
              el.style.cssText =
                "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;" +
                "background:#17211C;" +
                "color:#fff;font:600 13px/1.5 system-ui,sans-serif;padding:11px 18px;display:flex;gap:10px";
              el.innerHTML =
                `<span style="color:#8FCBA5">${r} / ${v}</span>` +
                `<span style="opacity:.85">${n}</span>` +
                `<span style="opacity:.5;margin-left:auto">${p}</span>`;
              document.body.appendChild(el);
            },
            [role, vp.name, route.name, route.path],
          )
          .catch(() => {});
        await page.waitForTimeout(SPEED);
      }

      const shot = join(OUT, `${role}-${vp.name}-${route.name}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      if (status >= 500) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "error",
          detail: `HTTP ${status}`,
        });
      }
      if (crashed) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "error",
          detail: "error boundary rendered",
        });
      }
      for (const e of [...new Set(pageErrors)]) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "error",
          detail: `pageerror: ${e.slice(0, 160)}`,
        });
      }
      for (const e of [...new Set(consoleErrors)].slice(0, 3)) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "warn",
          detail: `console: ${e.slice(0, 160)}`,
        });
      }
      for (const r of [...new Set(badRequests)].slice(0, 3)) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "warn",
          detail: `request ${r}`,
        });
      }
      if (overflow > 2) {
        record({
          role: role,
          view: vp.name,
          page: route.name,
          severity: "warn",
          detail: `overflows by ${overflow}px`,
        });
      }

      console.log(
        `  ${String(status).padEnd(4)} ${route.name.padEnd(20)}` +
          (redirected ? ` -> ${finalPath}` : "") +
          (overflow > 2 ? `  [+${overflow}px]` : ""),
      );
    }

    await context.close();
  }
}

await browser.close();

writeFileSync(join(OUT, "findings.json"), JSON.stringify(findings, null, 2));

const errors = findings.filter((f) => f.severity === "error");
const warns = findings.filter((f) => f.severity === "warn");
console.log(`\n${"=".repeat(60)}`);
console.log(`${errors.length} error(s), ${warns.length} warning(s). Screenshots in ${OUT}/`);
// Errors fail the run so this can gate a deploy; warnings are for reading.
process.exitCode = errors.length ? 1 : 0;
