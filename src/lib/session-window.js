/**
 * How long a signed-in session is allowed to last.
 *
 * SUPABASE DOES NOT DO THIS FOR YOU. Its access token expires in an hour, but
 * the refresh token rotates and renews the SAME session forever — every page
 * view silently buys another hour, and a session left alone for a week still
 * works when someone comes back to it. Measured against this project: 3600s
 * access token, rotating refresh, stable session_id, no start time recorded
 * anywhere. Nothing in the app was failing to expire a session; there was
 * simply no expiry to enforce.
 *
 * So the window is enforced here, in middleware, with two cookies:
 *
 *   IDLE   an HttpOnly marker whose maxAge IS the idle window. The browser
 *          drops it on its own, so there is no timestamp arithmetic and no
 *          clock to trust — a request arriving with a live session and no
 *          marker has been idle longer than the window.
 *   START  when this session began, SIGNED, so it cannot be edited to buy
 *          another day. Deliberately outlives the time-box (30 days) so that
 *          someone returning after 25 hours is still recognised as an expired
 *          session rather than a new one.
 */

/** No activity for this long and the session ends. */
export const IDLE_MS = 60 * 60 * 1000;

/** Hard ceiling. Active or not, sign in again after this. */
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * How long the start cookie survives. Must comfortably exceed MAX_SESSION_MS:
 * if it expired first, a session over the ceiling would arrive with no evidence
 * of when it began and be waved through as brand new — the one case the ceiling
 * exists for.
 */
const START_COOKIE_MS = 30 * 24 * 60 * 60 * 1000;

export const IDLE_COOKIE = "cds_active";
export const START_COOKIE = "cds_session_start";

/** Why a session ended, for the message on the login page. */
export const EXPIRED_IDLE = "idle";
export const EXPIRED_MAX = "max";

/**
 * The key the start cookie is signed with.
 *
 * Its own variable rather than a reused credential: an HMAC key that is also a
 * database password means rotating one forces the other. Absent, the time-box
 * cannot be enforced — `npm run preflight -- --live` fails on that, so it
 * cannot reach production quietly, but local development still runs.
 */
function key() {
  return process.env.SESSION_SECRET || null;
}

export function canEnforceTimebox() {
  return Boolean(key());
}

/**
 * WEB CRYPTO, NOT node:crypto.
 *
 * This module is imported by middleware, which Next runs on the Edge runtime —
 * where `node:crypto` does not exist and the import fails at BUILD time, taking
 * every route down with it, /login included. Everything below is therefore
 * async and uses the platform's SubtleCrypto, which both runtimes have.
 */
const encoder = new TextEncoder();

async function hmacKey() {
  const secret = key();
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(value) {
  const k = await hmacKey();
  if (!k) return null;
  const signature = await crypto.subtle.sign("HMAC", k, encoder.encode(String(value)));
  return base64url(new Uint8Array(signature));
}

/**
 * Constant-time string compare. Both sides are the same HMAC algorithm, so a
 * length mismatch means malformed rather than nearly-right, and returning early
 * on it leaks nothing an attacker did not already supply.
 */
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "<ms>.<signature>" — the value stored in the start cookie. */
export async function stampSessionStart(now = Date.now()) {
  const signature = await sign(now);
  return signature ? `${now}.${signature}` : null;
}

/**
 * The start time from a cookie, or null if it is missing, malformed, or
 * forged. A tampered stamp is treated exactly like no stamp at all, so editing
 * it cannot extend a session — only end it.
 */
export async function readSessionStart(value) {
  if (!value || !key()) return null;
  const cut = String(value).lastIndexOf(".");
  if (cut < 1) return null;

  const started = String(value).slice(0, cut);
  const offered = String(value).slice(cut + 1);
  if (!/^\d+$/.test(started)) return null;

  const expected = await sign(started);
  if (!expected || !equal(offered, expected)) return null;

  return Number(started);
}

/**
 * Decide what to do with a request that carries a valid Supabase session.
 *
 * @param {{idle?: string, start?: string}} cookies the two values, if present
 * @param {number} [now]
 * @returns {{expired: string|null, start: string|null}}
 *          `expired` is the reason to sign out, or null to let it through.
 *          `start` is a fresh stamp to set, or null to leave the cookie alone.
 */
export async function checkSessionWindow({ idle, start } = {}, now = Date.now()) {
  const startedAt = await readSessionStart(start);

  // Neither cookie: this is the first request after signing in. Nothing has
  // expired — there was nothing to expire yet — so open the window.
  if (!idle && startedAt == null) {
    return { expired: null, start: await stampSessionStart(now) };
  }

  // A live session with no activity marker has been away longer than the idle
  // window, whatever the start cookie says.
  if (!idle) return { expired: EXPIRED_IDLE, start: null };

  if (startedAt != null && now - startedAt > MAX_SESSION_MS) {
    return { expired: EXPIRED_MAX, start: null };
  }

  // Active, inside the ceiling. Re-stamp only if the start is missing or was
  // rejected as forged; otherwise keep the original, or the ceiling would move
  // on every request and never arrive.
  return { expired: null, start: startedAt == null ? await stampSessionStart(now) : null };
}

/** Cookie options shared by both markers. */
export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export const IDLE_COOKIE_OPTIONS = () => cookieOptions(IDLE_MS);
export const START_COOKIE_OPTIONS = () => cookieOptions(START_COOKIE_MS);
