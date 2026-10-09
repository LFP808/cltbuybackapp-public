import { createClient } from "@/lib/supabase/server";
import { rowToExpense } from "@/lib/mappers";
import { fetchAllRows } from "@/lib/repositories/all-rows";

/**
 * The expense ledger — running costs recorded on the admin /expenses screen.
 * See domain/expenses.js for what belongs here (and what stays on orders).
 */

/**
 * Every expense, newest spending first; a day's entries keep typing order.
 *
 * Paged: PostgREST caps even a limitless select at its own max-rows, and an
 * expense silently dropped from the ledger is an expense missing from every
 * P/L that follows. Paged ascending (fetchAllRows' contract), then flipped to
 * keep the newest-first API. The id tiebreak pins rows that share a timestamp.
 */
export async function listExpenses() {
  const supabase = await createClient();
  const { rows, truncated } = await fetchAllRows((from, to) =>
    supabase
      .from("expenses")
      .select("*")
      .order("spent_on", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const expenses = rows.reverse().map(rowToExpense);
  expenses.truncated = truncated;
  return expenses;
}

/** Record one expense. Validation happened in the action; this just writes. */
export async function addExpense({ spentOn, category, vendor, note, amount, createdBy }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      spent_on: spentOn,
      category,
      vendor: vendor || null,
      note: note || null,
      amount,
      created_by: createdBy || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToExpense(data);
}

/**
 * Remove an expense outright. A hard delete on purpose: unlike lots and
 * invoices this ledger is internal bookkeeping — nothing else references an
 * expense row, so a typo is corrected by removing it and entering it again.
 */
export async function deleteExpense(id) {
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}
