/**
 * What kind of customer this is — someone who books, or someone who just
 * turns up.
 *
 * DERIVED FROM THEIR ORDERS, never stored. The question staff actually ask
 * looking at a name is "do I book this person in, or do they walk in when
 * they've got stock?", and the honest answer to that is their history — not
 * a field somebody set once and never revisited.
 */

/** The badge for someone with no orders at all — a contact, not yet a customer. */
export const NO_KIND = { key: "none", label: "", local: true };

/**
 * Count a customer's orders into the buckets the flair is built from.
 *
 * Takes rows or domain orders — anything with `walkIn`/`walk_in` — because
 * the customer LIST aggregates raw rows straight from Postgres while the
 * customer PAGE has mapped orders, and making both agree by construction
 * beats making them agree by review.
 *
 * @param {Array<{type?: string, walkIn?: boolean, walk_in?: boolean}>} orders
 */
export function countKinds(orders = []) {
  const counts = { meetup: 0, walk_in: 0 };
  for (const o of orders) {
    if (!o) continue;
    if (o.walkIn === true || o.walk_in === true) counts.walk_in += 1;
    else counts.meetup += 1;
  }
  return counts;
}

/**
 * The flair itself.
 *
 * Names the habit when there is exactly one — "this person walks in" is a
 * useful thing to know before texting them a booking link — and says
 * "Regular" for someone who does both, because that is the one case where
 * either approach works.
 *
 * `local` survives on every kind for callers that still ask; everyone is
 * local now.
 *
 * @param {ReturnType<typeof countKinds>} counts
 * @returns {{key: string, label: string, local: boolean}}
 */
export function customerKind(counts) {
  const total = counts.meetup + counts.walk_in;
  if (total === 0) return NO_KIND;
  if (counts.walk_in === 0) return { key: "meetup", label: "Meetup", local: true };
  if (counts.meetup === 0) return { key: "walk_in", label: "Walk-in", local: true };
  return { key: "mixed", label: "Regular", local: true };
}

/**
 * The counts spelled out — "3 meetups, 1 walk-in" — for the flair's hover.
 *
 * A one-word badge is a summary, and a summary always loses something. This
 * is the receipt, and it costs a `title` attribute.
 */
export function kindSummary(counts) {
  const parts = [
    [counts.meetup, "meetup"],
    [counts.walk_in, "walk-in"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Straight from a list of orders, for callers that don't need the counts. */
export function kindOf(orders = []) {
  return customerKind(countKinds(orders));
}

/**
 * Filter keys for the customer list.
 *
 * EMPTY: with one location and one kind of handover there is no split worth
 * filtering by — "who books vs who walks in" is worth SHOWING on a name and
 * not worth a button row. The mechanism stays so the list component doesn't
 * change shape when a filter earns its place back.
 */
export const KIND_FILTERS = [];

/** Does this customer's flair belong under the given filter? */
export function matchesKindFilter(kind, filter) {
  if (!filter) return true;
  if (kind.key === "mixed") return true;
  return kind.key === filter;
}
