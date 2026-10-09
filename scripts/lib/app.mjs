import { loadEnv } from "./env.mjs";

/**
 * Where the running app is, and how to sign into it.
 *
 * loadEnv() IS CALLED HERE, at import time, and that is deliberate. ES module
 * imports are evaluated before the importing module's body runs, so a script
 * that imported this and then called loadEnv() itself would already have
 * evaluated this file — reading PORT out of an environment that had not been
 * loaded yet. Importing this module is therefore enough on its own.
 */
loadEnv();

/**
 * 3000, matching `npm run dev`.
 *
 * qa-flows used to default to 3100, where nothing listens, so
 * `npm run qa:flows` died on ERR_CONNECTION_REFUSED before running a single
 * check — the suite looked broken when only its default was.
 */
export const PORT = process.env.PORT || "3000";

/**
 * The one app there is. CLT Buyback serves a single hostname — the DTS
 * ancestor's app/portal host split (and baseUrl's host parameter with it)
 * went when the customer portal did.
 */
export const baseUrl = () => `http://localhost:${PORT}`;
export const APP = baseUrl();

/**
 * The seeded QA logins, keyed by role. These prefixes are exactly what
 * `npm run test-account` writes into .env.test.local.
 */
export const ROLE_ENV = {
  admin: "SHOOT_ADMIN",
  va: "SHOOT",
};
export const ROLES = Object.keys(ROLE_ENV);

/**
 * Credentials for a role, or an error saying exactly how to get them.
 *
 * shoot.mjs kept its own map of two roles and no admin, so `--as=admin` failed
 * with "no credentials" on a machine where test-account had seeded them. One
 * table, and a role either exists everywhere or nowhere.
 */
export function credentialsFor(role) {
  const prefix = ROLE_ENV[role];
  if (!prefix) throw new Error(`Unknown role "${role}". Try one of: ${ROLES.join(", ")}.`);

  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `No credentials for "${role}" — ${prefix}_EMAIL and ${prefix}_PASSWORD are not set. ` +
        "Run `npm run test-account`.",
    );
  }
  return { email, password };
}

/**
 * Sign in through the real login form, and return where it landed.
 *
 * Through the form rather than a forged cookie, so everything after this is
 * what a person would actually get: middleware, role gate and all. The landing
 * path is returned because it is itself a finding — homeFor() says both roles
 * land on /, and a role that lands anywhere else is a gate bug worth seeing.
 *
 * ON FAILURE THIS REPORTS THE FORM'S OWN ERROR. Every script but shoot.mjs used
 * to let a wrong password surface as a bare navigation timeout twenty seconds
 * later, attributed to whatever selector came next — which is how an afternoon
 * goes into debugging the app when the answer is "the QA user was reseeded".
 */
export async function signIn(page, role = "va", { base = APP, timeout = 20000 } = {}) {
  const { email, password } = credentialsFor(role);

  // networkidle, not domcontentloaded: the submit handler is attached at
  // hydration, and clicking before that does a native form post that goes
  // nowhere — a silent failure with nothing on screen to explain it.
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout });
  } catch {
    const shown = await page
      .locator("p.text-red-500, .text-red-500")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `Sign-in failed for "${role}" (${email}): ` +
        (shown?.trim() || "still on /login, and the form showed no error"),
    );
  }
  return new URL(page.url()).pathname;
}
