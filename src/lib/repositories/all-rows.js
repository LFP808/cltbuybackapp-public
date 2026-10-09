/**
 * Page a PostgREST query until the table runs out, and say so if it didn't.
 *
 * Two silent caps conspire against "read everything": our own page limits
 * (ORDER_PAGE_LIMIT, LOT_PAGE_LIMIT — deliberate, for browser-filtered lists)
 * and PostgREST's server-side max-rows, which quietly truncates even a query
 * with no .limit() at 1000 rows on a default Supabase project. A money total
 * computed over either is wrong with no indication — and it starts being wrong
 * exactly when the business grows past the cap, which is the moment the totals
 * matter most.
 *
 * ASCENDING order is part of the contract, not a style choice: rows are pages
 * of a moving table, and with newest-first ordering an insert that lands
 * mid-read shifts every later page down one, so the same row arrives twice.
 * Oldest-first pins existing rows in place — inserts append past the end.
 * Dedup by id closes whatever gap remains.
 *
 * @param {(from: number, to: number) => PromiseLike<{data: any[]|null, error: any}>} pageQuery
 *   builds one page: a PostgREST query with .range(from, to) applied and an
 *   ASCENDING stable order.
 * @returns {Promise<{rows: any[], truncated: boolean}>} truncated only when the
 *   runaway ceiling was hit — the caller must surface it, never swallow it.
 */
export async function fetchAllRows(pageQuery) {
  // PostgREST's per-request ceiling; asking for more just gets this many.
  const PAGE = 1000;
  // A backstop against a runaway table, far above today's volume. At 50k rows
  // the money page needs a real aggregation strategy, not a bigger loop.
  const CEILING = 50_000;

  const rows = [];
  const seen = new Set();
  for (let from = 0; from < CEILING; from += PAGE) {
    const { data, error } = await pageQuery(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      if (row?.id != null && seen.has(row.id)) continue;
      if (row?.id != null) seen.add(row.id);
      rows.push(row);
    }
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
