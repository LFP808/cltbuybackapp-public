/**
 * The shape a Server Action uses to report an EXPECTED failure.
 *
 * Next strips the message off anything a Server Action throws in a production
 * build, replacing it with a generic "an error occurred" plus a digest, and it
 * drops custom properties entirely. A thrown "This customer already has an open
 * order" therefore reaches the browser as boilerplate, and `err.fieldErrors`
 * never arrives at all — while working perfectly in dev, which is the worst way
 * for a bug to behave. Measured on a production build of this app: of fourteen
 * actions, the thirteen that threw returned a bare digest, and the one that
 * returned came back with its message and field map intact.
 *
 * So: anything a user can legitimately hit comes back as `{ error, ...context }`
 * and the caller checks `result.error`. Throwing is reserved for genuine faults,
 * where the generic message is the right thing to show anyway.
 *
 * This lives outside the action files because a "use server" module may only
 * export async functions — `fail` cannot be exported from one, and copying it
 * into each file is how the four action files drifted apart in the first place.
 */

/**
 * An expected, user-facing failure.
 *
 * @param {string} error   message safe to show the person who triggered it
 * @param {object} [context] extra fields the caller acts on, e.g.
 *                           `{ fieldErrors }` to highlight inputs or
 *                           `{ duplicateCount }` to offer a way through
 * @returns {{ error: string } & Record<string, unknown>}
 */
export function fail(error, context = {}) {
  return { error, ...context };
}
