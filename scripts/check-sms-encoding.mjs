/**
 * Guard against a costly, invisible regression in customer SMS copy.
 *
 * A text made only of GSM-7 characters bills at 153 characters per segment.
 * One character outside that alphabet — an em dash, a curly quote, an ellipsis,
 * an emoji — silently re-encodes the entire message as UCS-2 at 67 characters
 * per segment, roughly doubling the cost of every send. Nothing in the app
 * surfaces that; it just shows up on the Twilio bill.
 *
 * Scans the SMS template source and fails if any non-GSM-7 character appears.
 *
 *   node scripts/check-sms-encoding.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Importing src/domain/sms.js (a `.js` ESM file in a package with no "type"
// field) makes Node's loader print a four-line "reparsing as ES module"
// warning on every run. The flag that silences it cannot be set from inside a
// running process, and `node script.mjs` reads no flags from a shebang — so
// re-exec once with it. Output and exit code pass straight through.
const FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
if (!process.execArgv.includes(FLAG)) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [FLAG, fileURLToPath(import.meta.url)], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

// THE alphabet, not A copy of it. This check and the in-app cost meter must
// agree on what GSM-7 is, or the check can pass while the composer (and the
// bill) disagree. domain/sms.js has no imports of its own, so plain Node can
// load it here without a bundler.
const { nonGsmCharacters } = await import("../src/domain/sms.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Every file that composes something Twilio sends, whether the recipient is a
// customer or not. Staff messages bill exactly the same way, and a morning
// digest goes out often enough for one em dash to be a standing charge rather
// than a one-off.
const TARGETS = [
  "src/domain/messages.js",
  "src/domain/digest.js",
  "src/domain/appointment-alert.js",
  // Not a template file, but its section labels are the digest's lines — one
  // em dash in a label re-encodes the morning text just the same.
  "src/domain/attention.js",
];

/**
 * Backtick delimits JS template literals and never reaches a customer, so it
 * would be a false positive. Every other character in these files is either
 * message copy or ordinary ASCII syntax that is already GSM-7.
 */
const SYNTAX_ONLY = new Set("`");

let failed = false;

for (const rel of TARGETS) {
  const source = readFileSync(join(ROOT, rel), "utf8");
  const offenders = new Map(); // char -> line numbers

  source.split("\n").forEach((line, i) => {
    for (const ch of nonGsmCharacters(line)) {
      if (SYNTAX_ONLY.has(ch)) continue;
      if (!offenders.has(ch)) offenders.set(ch, []);
      offenders.get(ch).push(i + 1);
    }
  });

  if (offenders.size === 0) {
    console.log(`✓ ${rel} — all GSM-7 (153 chars/segment)`);
    continue;
  }

  failed = true;
  console.error(`✗ ${rel} — non-GSM-7 characters force UCS-2 (67 chars/segment):`);
  for (const [ch, lines] of offenders) {
    const codepoint = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    console.error(
      `    ${JSON.stringify(ch)} ${codepoint} on line${
        lines.length > 1 ? "s" : ""
      } ${lines.join(", ")}`,
    );
  }
}

if (failed) {
  console.error("\nReplace with ASCII equivalents: - for —, ... for …, straight quotes.");
  process.exit(1);
}
