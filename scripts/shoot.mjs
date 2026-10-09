/**
 * Screenshot a page of the running app, at phone and desktop widths.
 *
 *   node scripts/shoot.mjs /calendar                 # signed in as the VA
 *   node scripts/shoot.mjs /calendar --as=admin      # or any seeded role
 *   node scripts/shoot.mjs /orders/<uuid> --name=meetup-detail
 *   node scripts/shoot.mjs /login --no-auth
 *
 * Writes PNGs to ./screenshots (gitignored) as <name>-<role>-<mobile|desktop>.png
 *
 * Signs in through the real login form rather than forging a cookie, so what
 * gets captured is what a person would actually see — middleware, role gate and
 * all. Requires the server on http://localhost:PORT (default 3000).
 *
 * Credentials come from the environment, never from the repo — every role that
 * `npm run test-account` seeds works here (admin, va).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { flag, has, positional } from "./lib/args.mjs";
import { APP, signIn } from "./lib/app.mjs";

const path = positional("/");
const as = flag("as", "va");
// Not dot-prefixed: these exist to be looked at, and a hidden folder doesn't
// show up in Finder or most file trees.
const outDir = flag("out", "screenshots");
const base = APP;

// iPhone-ish and laptop-ish. Two widths catch nearly every layout break.
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
];

mkdirSync(outDir, { recursive: true });

/**
 * File stem for this run. `--name=` wins, because a path containing a uuid
 * produces a filename nobody can read at a glance — the whole point of these
 * being on disk is that a person opens the folder and knows what they're
 * looking at.
 */
const slug =
  flag("name", null) || path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));

    if (!has("no-auth")) await signIn(page, as, { base });

    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    // Let the loading.jsx boundary resolve and any animation settle.
    await page.waitForTimeout(700);

    // --click="Walk-in" reaches state behind a tab or toggle, which is
    // otherwise unreachable in a screenshot.
    const click = flag("click", null);
    if (click) {
      await page.getByText(click, { exact: false }).first().click();
      await page.waitForTimeout(400);
    }

    // --fill="Phone::2144485655,Customer name::Jane" captures states that only
    // appear once a field has content — validation errors, lookup results.
    // Focus moves to the next field after each, so on-blur handlers fire.
    const fill = flag("fill", null);
    if (fill) {
      for (const pair of fill.split(",")) {
        const [label, value = ""] = pair.split("::");
        await page.getByLabel(label.trim(), { exact: false }).first().fill(value);
        await page.keyboard.press("Tab");
        await page.waitForTimeout(300);
      }
      // Give any lookup the field triggered time to come back.
      await page.waitForTimeout(1200);
    }

    const file = join(outDir, `${slug}-${as}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });

    // Horizontal overflow is the layout bug that hides in a screenshot.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    console.log(`  ${vp.name.padEnd(8)} ${file}`);
    console.log(`           url: ${page.url()}`);
    console.log(
      `           horizontal overflow: ${overflow > 0 ? `${overflow}px  <-- BUG` : "none"}`,
    );
    if (problems.length) {
      console.log(`           console errors: ${problems.slice(0, 3).join(" | ")}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
