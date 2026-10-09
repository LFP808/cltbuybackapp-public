/**
 * What a text will actually cost to send.
 *
 * Carriers bill per 160-character segment, but only for the GSM 03.38 alphabet.
 * A single character outside it — an em dash, a curly quote pasted from a
 * document, an emoji — silently re-encodes the WHOLE message as UCS-2, where a
 * segment is 70 characters. A 200-character message is 2 segments as ASCII and
 * 3 as Unicode, and nothing in a normal compose box shows that.
 *
 * Pure functions so the composer, the template checker, and any future
 * reporting all count the same way.
 */

/** GSM 03.38 basic alphabet — one septet each. */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);

/** Extension table — legal in GSM-7, but each costs two septets. */
const GSM_EXTENDED = new Set("^{}\\[~]|€");

const LIMITS = {
  "GSM-7": { single: 160, multi: 153 },
  "UCS-2": { single: 70, multi: 67 },
};

/** Whether every character fits the GSM-7 alphabet. */
export function isGsm7(text) {
  return [...String(text ?? "")].every((ch) => GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch));
}

/**
 * Billing shape of a message.
 *
 * @param {string} text
 * @returns {{ encoding: 'GSM-7'|'UCS-2', units: number, segments: number,
 *             perSegment: number, remaining: number }}
 *   `units` is billable characters (GSM extension chars count twice; astral
 *   characters like most emoji take two UCS-2 code units).
 */
export function smsCost(text) {
  const value = String(text ?? "");
  const gsm = isGsm7(value);
  const encoding = gsm ? "GSM-7" : "UCS-2";

  const units = gsm
    ? [...value].reduce((n, ch) => n + (GSM_EXTENDED.has(ch) ? 2 : 1), 0)
    : [...value].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);

  const limits = LIMITS[encoding];
  const perSegment = units <= limits.single ? limits.single : limits.multi;
  const segments = units === 0 ? 0 : Math.ceil(units / perSegment);

  return {
    encoding,
    units,
    segments,
    perSegment,
    remaining: Math.max(0, perSegment * Math.max(segments, 1) - units),
  };
}

/**
 * The characters pushing a message into UCS-2, deduped and in first-seen order.
 * Lets the UI say WHICH character to remove rather than just that one exists.
 */
export function nonGsmCharacters(text) {
  const seen = new Set();
  for (const ch of String(text ?? "")) {
    if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch)) seen.add(ch);
  }
  return [...seen];
}

/**
 * Typography that NFKD won't fold but that has an obvious ASCII twin. Word
 * processors and phone keyboards insert these into pasted names and streets;
 * each one alone re-encodes a whole message.
 */
const FOLD_MAP = new Map(
  Object.entries({
    "\u2010": "-", // hyphen
    "\u2011": "-", // non-breaking hyphen
    "\u2012": "-", // figure dash
    "\u2013": "-", // en dash
    "\u2014": "-", // em dash
    "\u2018": "'", // curly quotes
    "\u2019": "'",
    "\u201A": "'",
    "\u201C": '"',
    "\u201D": '"',
    "\u201E": '"',
    "\u2026": "...", // ellipsis
    "\u00A0": " ", // no-break space
    "\u202F": " ", // narrow no-break space
    "\u200B": "", // zero-width space
  }),
);

/**
 * The closest GSM-7 spelling of a text, so one pasted character can't double
 * the bill.
 *
 * The templates are policed by scripts/check-sms-encoding.mjs, but what gets
 * INTERPOLATED into them is not: a customer named María — í is outside the
 * alphabet, though é is in it — flips the entire message to UCS-2 at half the
 * characters per segment, visible only on the Twilio invoice. This folds the
 * accent off (María -> Maria) at the send path.
 *
 * A character with no reasonable fold — a CJK name, an emoji — is KEPT, not
 * replaced with "?": spelling a customer's name as punctuation to save a
 * segment is the wrong trade. That one message pays UCS-2 honestly.
 */
export function foldToGsm7(text) {
  const value = String(text ?? "");
  if (isGsm7(value)) return value;

  let out = "";
  for (const ch of value) {
    if (GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch)) {
      out += ch;
      continue;
    }
    const mapped = FOLD_MAP.get(ch);
    if (mapped != null) {
      out += mapped;
      continue;
    }
    // í -> i + combining acute -> i. Only accepted when everything that comes
    // out is GSM-7 — NFKD can also emit new non-GSM characters (½ -> 1⁄2).
    const folded = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (folded && isGsm7(folded)) {
      out += folded;
      continue;
    }
    out += ch;
  }
  return out;
}
