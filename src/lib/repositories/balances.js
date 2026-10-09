import { createClient } from "@/lib/supabase/server";
import { rowToBalanceSnapshot } from "@/lib/mappers";

/**
 * Counted balances — the anchor /pl's running total rolls forward from.
 * See domain/cash.js for what the number means and why it is called "expected".
 *
 * MISSING TABLE IS NOT AN ERROR HERE. Migrations in this project are applied by
 * hand, so there is a window where the code knows about `balance_snapshots` and
 * the database does not. Every read below answers "not set up yet" instead of
 * throwing, which is the difference between /pl showing cash flow with one card
 * greyed out and /pl being a stack trace.
 */

/** Postgres/PostgREST codes for "that table isn't there". */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

function isMissingTable(error) {
  return Boolean(error) && MISSING_TABLE.has(error.code);
}

/** Every snapshot, newest first. Empty array when the table doesn't exist yet. */
export async function listBalanceSnapshots() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("balance_snapshots")
    .select("*")
    .order("as_of", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? []).map(rowToBalanceSnapshot);
}

/** The most recent counted balance, or null when there is none (or no table). */
export async function latestBalanceSnapshot() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("balance_snapshots")
    .select("*")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data ? rowToBalanceSnapshot(data) : null;
}

/**
 * Record a counted balance.
 *
 * Upserts on `as_of`: entering today's figures twice CORRECTS today rather than
 * stacking a second anchor for the same day, which the running balance would
 * then have to choose between. Fixing a typo is re-entering the day.
 */
export async function saveBalanceSnapshot({ asOf, bank, cash, note, createdBy }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("balance_snapshots")
    .upsert(
      {
        as_of: asOf,
        bank: bank ?? 0,
        cash: cash ?? 0,
        note: note || null,
        created_by: createdBy || null,
      },
      { onConflict: "as_of" },
    )
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return rowToBalanceSnapshot(data);
}
