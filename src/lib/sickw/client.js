/**
 * Sickw IMEI/serial lookup — the device-facts source behind check-in. Server
 * only; called from server actions (sickwLookupAction), never from the client.
 *
 * One endpoint, GET https://sickw.com/api.php, where the SERVICE ID picks
 * which report is run (and what it costs per hit): each id is a different
 * product on Sickw's menu — e.g. 30 is "Apple Full Info [+Carrier]", the one
 * report that covers model, carrier lock, FMI, iCloud and blacklist in a
 * single call, which is why it is the default. Override per deployment with
 * SICKW_SERVICE_ID, or per call for a one-off cheaper/deeper report.
 *
 * Expected failures are RETURNED as { ok:false, error }, never thrown — a
 * thrown message is stripped in a production build (see CLAUDE.md), and every
 * failure here is expected: a mistyped IMEI, an empty Sickw balance, Sickw
 * being down. The caller checks result.ok and shows result.error verbatim.
 */

import { sickwFixture } from "./fixtures.js";

const API_URL = "https://sickw.com/api.php";

/**
 * Which Sickw report a lookup runs when SICKW_SERVICE_ID is unset. "30" is
 * Sickw's Apple Full Info [+Carrier] report. A STRING on purpose: Sickw ids
 * are opaque tokens in a query string, not numbers to do math on.
 */
export const DEFAULT_SICKW_SERVICE_ID = "30";

/**
 * How long a lookup may take before we give up. Sickw fans out to Apple/GSX
 * sources behind the scenes and a slow source can stall a response for
 * minutes; without a deadline that is a check-in form frozen on "Look up"
 * until the platform kills the whole server action.
 *
 * GENEROUS ON PURPOSE (Jaime, 2026-10-03, raised from 15s): every hit to
 * this endpoint is billed whether or not we stuck around for the answer —
 * aborting the fetch stops US from waiting, not Sickw from having already
 * started the lookup. A timeout that is too short does not save the charge,
 * it just throws away an answer that was seconds from arriving, and the
 * obvious next move — clicking Look up again — pays for a second lookup of
 * the same device. 50s leaves a 10s margin under actions.js's maxDuration
 * (the platform's own hard cutoff), so a genuinely dead request still fails
 * with a clean, retryable message instead of the whole function dying.
 */
const SICKW_TIMEOUT_MS = 50_000;

/** "1"/"true"/"yes" style env truthiness; unset, "", "0" and "false" are off. */
function envTruthy(value) {
  return Boolean(value) && !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function config() {
  const key = process.env.SICKW_API_KEY || "";
  return {
    key,
    serviceId: process.env.SICKW_SERVICE_ID || DEFAULT_SICKW_SERVICE_ID,
    // No key means test mode, not an error: every real hit costs money from a
    // prepaid Sickw balance, so an unconfigured machine must never be one
    // typo'd env file away from spending it — and check-in has to be
    // exercisable fully offline (fixtures below).
    isTest: envTruthy(process.env.SICKW_TEST_MODE) || !key,
  };
}

/** Whether lookups are answered from canned fixtures instead of Sickw. */
export function isSickwTestMode() {
  return config().isTest;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Stable field names the check-in form reads, each with the raw Sickw
 * spellings that mean it, in priority order. Sickw's reports are not a fixed
 * schema — different services (and the same service across time) label the
 * same fact "Model Name", "Model" or only "Model Description"; "SIM-Lock" vs
 * "SIMLock Status"; "Find My iPhone" vs "FMi". parseSickwResult keeps every
 * raw key AND surfaces these aliases, so callers branch on one spelling.
 *
 * Order matters where it is not obvious: for `model` the marketing name
 * ("iPhone 15 Pro Max") is wanted, so the factory Model Description string
 * ("IPHONE 15 PRO MAX NATURAL TITANIUM 256GB-USA") is the last resort, not
 * the first hit.
 */
const WELL_KNOWN = {
  model: [
    "model_name",
    "marketing_name",
    "model",
    "device_name",
    "device",
    "model_description",
    "model_desc",
    "description",
  ],
  model_number: ["model_number", "model_no", "model_code", "part_number", "a_number"],
  imei: ["imei", "imei_number", "imei1"],
  imei2: ["imei2", "imei_2", "second_imei"],
  serial: ["serial", "serial_number", "serial_no", "sn"],
  color: ["color", "colour", "device_color", "device_colour"],
  storage: ["storage", "capacity", "memory", "storage_capacity", "internal_memory"],
  carrier: [
    "carrier",
    "locked_carrier",
    "network",
    "sold_by_carrier",
    // Apple's own name for the carrier-lock policy; often the only place the
    // carrier appears on a locked phone.
    "next_tether_policy_description",
    "next_tether_policy",
  ],
  sim_lock: ["sim_lock", "simlock", "sim_lock_status", "simlock_status", "lock_status"],
  fmi: ["fmi", "find_my_iphone", "find_my_iphone_status", "fmi_status", "fmip", "icloud_lock"],
  icloud_status: ["icloud_status", "icloud"],
  blacklist_status: ["blacklist_status", "blacklist", "gsma_blacklist_status", "blacklisted"],
  purchase_country: ["purchase_country", "country_purchased", "sold_in", "country"],
  warranty: ["warranty", "warranty_status", "warranty_coverage", "coverage"],
  battery: ["battery", "battery_health", "battery_status", "battery_condition"],
};

/** "Find My iPhone" -> "find_my_iphone"; "SIM-Lock" -> "sim_lock". */
function normalizeKey(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The handful of HTML entities Sickw actually emits; not a general decoder. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'");
}

/**
 * Tags out, whitespace collapsed. Tags are stripped BEFORE splitting a line
 * on ":" because the markup itself can contain colons (style="color:red")
 * that would otherwise masquerade as the key/value separator.
 */
function cleanText(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  if (value == null) return "";
  // Nested structures stay in `raw` (which the caller stores as details
  // jsonb); flattening them into fields would invent keys nothing reads.
  if (typeof value === "object") return "";
  return cleanText(value);
}

/**
 * Normalize Sickw's `result` payload into a flat field map.
 *
 * Pure — no env, no network — so it can be exercised directly. Sickw returns
 * `result` in one of two shapes depending on the service: an object of
 * key/values, or an HTML-ish string of "Key: Value<br>Key: Value" lines
 * (values sometimes wrapped in <font> for the red/green verdicts). Both
 * normalize the same way:
 *
 *   - every key lowercased to snake_case, value stripped of markup;
 *   - unknown keys pass through untouched — a new fact Sickw starts
 *     reporting shows up instead of vanishing;
 *   - the WELL_KNOWN names above are additionally surfaced under their
 *     stable spelling (originals kept, so nothing is lost).
 *
 * Lines without a colon (banners, ads, blank runs) are dropped. Values keep
 * any further colons — the split is on the FIRST one only, so
 * "Purchase Date: 2023-10-05 12:30" survives intact.
 *
 * @param {object|string|null|undefined} result  Sickw's `result` field
 * @returns {Record<string, string>} normalized fields
 */
export function parseSickwResult(result) {
  const fields = {};
  const put = (rawKey, rawValue) => {
    const key = normalizeKey(rawKey);
    if (!key) return;
    const value = typeof rawValue === "string" ? cleanText(rawValue) : cleanValue(rawValue);
    // First occurrence wins: a duplicated key in Sickw's output repeats the
    // same fact, and the first line is the canonical one.
    if (value !== "" && !(key in fields)) fields[key] = value;
  };

  if (result && typeof result === "object" && !Array.isArray(result)) {
    for (const [k, v] of Object.entries(result)) put(k, v);
  } else if (typeof result === "string") {
    // <br> is the line separator; strip remaining tags per line, THEN split
    // on the first colon (see cleanText for why that order).
    for (const line of result.split(/<br\s*\/?>|\r?\n/i)) {
      const text = cleanText(line);
      const idx = text.indexOf(":");
      if (idx <= 0) continue;
      put(text.slice(0, idx), text.slice(idx + 1));
    }
  }

  // ALWAYS resolve from alias priority order, never skip because fields[stable]
  // is already set. `model`'s own aliases are ["model_name", "marketing_name",
  // "model", ...] - "model" (the marketing name's last-priority synonym) is
  // also literally the STABLE key's own name. A raw "Model" line (distinct
  // from "Model Name"/"Model Description", and sometimes a bare model code
  // rather than a marketing name) normalizes to that same key during
  // ingestion above, so a `continue` here used to treat that coincidence as
  // "already resolved" and skip the higher-priority "Model Name" entirely -
  // producing the wrong name at check-in whenever a report sent both.
  for (const [stable, aliases] of Object.entries(WELL_KNOWN)) {
    for (const alias of aliases) {
      if (fields[alias]) {
        fields[stable] = fields[alias];
        break;
      }
    }
  }
  return fields;
}

/* ------------------------------------------------------------------ */
/* Lookup                                                             */
/* ------------------------------------------------------------------ */

/**
 * Look a device up on Sickw by IMEI (or serial — Macs have no IMEI; Sickw
 * accepts either in the same parameter).
 *
 * Never throws for an expected failure. The caller (a server action) checks
 * `ok` and returns `error` to the form.
 *
 * @param {string} imei  IMEI or serial number, as typed
 * @param {{ service?: string }} [options]  override the report id for this call
 * @returns {Promise<{ ok: true, fields: Record<string,string>, raw: object }
 *                 | { ok: false, error: string }>}
 *   `fields` is the parseSickwResult map; `raw` is Sickw's whole JSON body,
 *   kept verbatim for the lot's details jsonb.
 */
export async function sickwLookup(imei, { service } = {}) {
  const query = String(imei ?? "").trim();
  if (!query) return { ok: false, error: "Enter an IMEI or serial number." };

  const { key, serviceId, isTest } = config();
  if (isTest) return sickwFixture(query);

  const url = new URL(API_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("key", key);
  url.searchParams.set("imei", query);
  url.searchParams.set("service", service || serviceId);

  // AbortController rather than hoping: fetch waits forever by default, and a
  // stalled lookup must come back as words, not a stuck button.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SICKW_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return {
        ok: false,
        error: `Sickw did not answer within ${SICKW_TIMEOUT_MS / 1000} seconds. Try again in a moment.`,
      };
    }
    // DNS failure / dropped connection arrives as a bare TypeError("fetch
    // failed") — true, but not something a person at the counter can act on.
    return { ok: false, error: "Could not reach Sickw. Check the connection and try again." };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { ok: false, error: `Sickw answered HTTP ${res.status}. Try again in a moment.` };
  }

  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { ok: false, error: "Sickw's response could not be read. Try again in a moment." };
  }

  // Sickw's verdict rides INSIDE a 200: {"status":"error","result":"..."}
  // with the human-readable reason in `result` (wrong IMEI, empty balance,
  // service down). Pass Sickw's own words through — they are the actionable
  // part.
  if (String(body?.status).toLowerCase() !== "success") {
    const said = typeof body?.result === "string" ? cleanText(body.result) : "";
    return { ok: false, error: said || "Sickw could not run this lookup. Try again in a moment." };
  }

  return { ok: true, fields: parseSickwResult(body.result), raw: body };
}
