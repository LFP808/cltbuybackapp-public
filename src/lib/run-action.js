/**
 * Call a Server Action and get one outcome shape back, however it failed.
 *
 * An action can disappoint you two ways: it RETURNS `{ error }` for something a
 * user can legitimately hit (see lib/action-result.js), or it THROWS for a
 * genuine fault. A caller that handles only one of them loses the other
 * silently — and "silently" is literal: the box clears, the modal closes, the
 * page refreshes, and the thing the person asked for never happened. Every
 * component doing its own try/catch is how this codebase ended up with call
 * sites that check `result.textError` but not `result.error`.
 *
 * So: one helper, both shapes, no throw.
 *
 *   const { ok, error, result } = await runAction(() => saveThing(id, form));
 *   if (!ok) { setError(error); return; }
 *
 * `result` is the action's return value on success, and on a returned failure
 * it is still handed back — so a caller that wants the extra context
 * (`fieldErrors`, `duplicateCount`) can read it off `result`.
 *
 * @param {() => Promise<any>} fn
 * @param {string} [fallback] message for a fault with nothing readable on it
 * @returns {Promise<{ ok: boolean, error: string|null, result: any }>}
 */
export async function runAction(fn, fallback = "Something went wrong.") {
  try {
    const result = await fn();
    if (result?.error) return { ok: false, error: result.error, result };
    return { ok: true, error: null, result };
  } catch (err) {
    // redirect() and notFound() are implemented as throws. Swallowing them
    // would turn a navigation into a red error line.
    if (typeof err?.digest === "string" && err.digest.startsWith("NEXT_")) throw err;

    // A production Server Action fault does NOT arrive message-less: Next sets
    // `message` to its own "an error occurred… omitted in production builds"
    // paragraph and attaches a digest. Showing that to staff is worse than
    // useless, so the digest is the signal to use our own words instead.
    if (err?.digest) return { ok: false, error: fallback, result: null };

    return { ok: false, error: err?.message || fallback, result: null };
  }
}
