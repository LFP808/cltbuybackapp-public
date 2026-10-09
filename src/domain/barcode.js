/**
 * Code 128 — the barcode on the device labels.
 *
 * Pure: a string in, a module pattern out. No SVG, no DOM — the label page
 * draws the pattern, and keeping the encoder free of rendering means it can
 * be checked in plain Node (sum of every symbol is 11 modules, the checksum
 * arithmetic is deterministic) without a browser.
 *
 * WHY CODE 128 AND NOT A QR CODE. The label is scanned INTO this app's own
 * IMEI field (check-in, the grid search) and into the buyers' sheets, with
 * ordinary USB/Bluetooth wedge scanners that type what they read. Code 128
 * is what every one of those reads out of the box, and in code set C it packs
 * two digits per symbol, so a 15-digit IMEI fits the device label with room
 * for the quiet zones at the 203 dpi a thermal label printer prints at. A
 * serial (letters) falls back to code set B, which is longer but still fits.
 *
 * Patterns are the standard table as module bitmaps (1 = bar, 0 = space),
 * 11 modules each, 13 for the stop pattern — copied bitmap-for-bitmap from
 * the reference table rather than re-typed as widths, because a single
 * transposed digit in a width table produces a barcode that looks right and
 * never scans.
 */

const PATTERNS = [
  "11011001100",
  "11001101100",
  "11001100110",
  "10010011000",
  "10010001100",
  "10001001100",
  "10011001000",
  "10011000100",
  "10001100100",
  "11001001000",
  "11001000100",
  "11000100100",
  "10110011100",
  "10011011100",
  "10011001110",
  "10111001100",
  "10011101100",
  "10011100110",
  "11001110010",
  "11001011100",
  "11001001110",
  "11011100100",
  "11001110100",
  "11101101110",
  "11101001100",
  "11100101100",
  "11100100110",
  "11101100100",
  "11100110100",
  "11100110010",
  "11011011000",
  "11011000110",
  "11000110110",
  "10100011000",
  "10001011000",
  "10001000110",
  "10110001000",
  "10001101000",
  "10001100010",
  "11010001000",
  "11000101000",
  "11000100010",
  "10110111000",
  "10110001110",
  "10001101110",
  "10111011000",
  "10111000110",
  "10001110110",
  "11101110110",
  "11010001110",
  "11000101110",
  "11011101000",
  "11011100010",
  "11011101110",
  "11101011000",
  "11101000110",
  "11100010110",
  "11101101000",
  "11101100010",
  "11100011010",
  "11101111010",
  "11001000010",
  "11110001010",
  "10100110000",
  "10100001100",
  "10010110000",
  "10010000110",
  "10000101100",
  "10000100110",
  "10110010000",
  "10110000100",
  "10011010000",
  "10011000010",
  "10000110100",
  "10000110010",
  "11000010010",
  "11001010000",
  "11110111010",
  "11000010100",
  "10001111010",
  "10100111100",
  "10010111100",
  "10010011110",
  "10111100100",
  "10011110100",
  "10011110010",
  "11110100100",
  "11110010100",
  "11110010010",
  "11011011110",
  "11011110110",
  "11110110110",
  "10101111000",
  "10100011110",
  "10001011110",
  "10111101000",
  "10111100010",
  "11110101000",
  "11110100010",
  "10111011110",
  "10111101110",
  "11101011110",
  "11110101110",
  "11010000100", // 103 Start A
  "11010010000", // 104 Start B
  "11010011100", // 105 Start C
  "1100011101011", // 106 Stop
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
// Code-set switches, as symbol values. Inside set C, value 100 means "switch
// to B"; inside set B, 99 means "switch to C".
const CODE_B = 100;
const CODE_C = 99;

/** Modules of empty space either side of the code. The spec says 10 minimum. */
export const QUIET_ZONE = 10;

/**
 * Whether this text can be encoded at all: printable ASCII (code set B).
 * Anything else — a Unicode dash somebody pasted, a control character — is
 * refused rather than silently dropped, because a label that scans to a
 * different string than it prints is worse than no label.
 */
export function canEncode(text) {
  return typeof text === "string" && text.length > 0 && /^[\x20-\x7E]+$/.test(text);
}

/**
 * Encode text as Code 128.
 *
 * Numeric-only text of 4+ characters uses set C for every digit pair, with
 * a single trailing digit (a 15-digit IMEI has one) switched into set B.
 * Everything else is set B throughout. Not the full ISO optimisation — two
 * switches inside a mixed string are rare on a device label and the simple
 * rule produces a scannable, near-shortest code for the two shapes this app
 * prints: IMEIs (digits) and serials (letters and digits).
 *
 * @param {string} text
 * @returns {{ modules: string, symbols: number[] } | null}
 *   `modules` is the bar/space bitmap including quiet zones; null when the
 *   text can't be encoded.
 */
export function encodeCode128(text) {
  if (!canEncode(text)) return null;

  const symbols = [];
  const numeric = /^\d+$/.test(text) && text.length >= 4;

  if (numeric) {
    symbols.push(START_C);
    let i = 0;
    for (; i + 1 < text.length; i += 2) {
      symbols.push(Number(text.slice(i, i + 2)));
    }
    if (i < text.length) {
      symbols.push(CODE_B);
      symbols.push(text.charCodeAt(i) - 32);
    }
  } else {
    symbols.push(START_B);
    for (const ch of text) symbols.push(ch.charCodeAt(0) - 32);
  }

  // Modulo-103 checksum: the start symbol weighs 1, every symbol after it
  // weighs its 1-based position.
  let sum = symbols[0];
  for (let i = 1; i < symbols.length; i += 1) sum += symbols[i] * i;
  symbols.push(sum % 103);
  symbols.push(STOP);

  const quiet = "0".repeat(QUIET_ZONE);
  const modules = quiet + symbols.map((s) => PATTERNS[s]).join("") + quiet;
  return { modules, symbols };
}

/**
 * The bars of a module bitmap as [start, width] runs — what a renderer draws
 * as rectangles. Pure arithmetic kept here so the label page is only layout.
 *
 * @param {string} modules
 * @returns {Array<[number, number]>}
 */
export function barRuns(modules) {
  const runs = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== "1") {
      i += 1;
      continue;
    }
    const start = i;
    while (i < modules.length && modules[i] === "1") i += 1;
    runs.push([start, i - start]);
  }
  return runs;
}

/** Exposed for the self-check script; every symbol must sum to 11 (stop: 13). */
export const CODE128_PATTERNS = PATTERNS;
export { CODE_B as CODE128_CODE_B, CODE_C as CODE128_CODE_C };
