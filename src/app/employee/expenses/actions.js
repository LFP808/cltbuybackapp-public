"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canAccess } from "@/domain/access";
import { validateExpense } from "@/domain/expenses";
import { addExpense, deleteExpense } from "@/lib/repositories/expenses";

/**
 * Server actions for the expense ledger. Same contract as every action file:
 * EXPECTED FAILURES ARE RETURNED via fail(), throwing is reserved for genuine
 * faults (see app/employee/actions.js for the long version of why).
 *
 * Middleware already keeps non-admins off /expenses, but an action is a public
 * POST endpoint in its own right, so each one re-checks the same ROUTE_ACCESS
 * rule it is reachable from — the gate and the door match.
 */

export async function addExpenseAction(input) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/expenses")) return fail("You can't record expenses.");

  const errors = validateExpense(input);
  if (Object.keys(errors).length) {
    return fail("Check the highlighted fields.", { fieldErrors: errors });
  }

  await addExpense({
    spentOn: input.spentOn,
    category: String(input.category).trim(),
    vendor: String(input.vendor || "").trim(),
    note: String(input.note || "").trim(),
    amount: Math.round(Number(input.amount) * 100) / 100,
    createdBy: staff.name,
  });

  revalidatePath("/employee/expenses");
  // The Money page reads this ledger too — its P/L expense lines, and since
  // owner draws became a category (2026-08-08), the business-money pot. The
  // draw modal LIVES on that page, so without this its own save looks like
  // nothing happened until a hard reload.
  revalidatePath("/employee/pl");
}

export async function deleteExpenseAction(id) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/expenses")) return fail("You can't remove expenses.");
  if (!id) return fail("Expense not found.");

  await deleteExpense(id);
  revalidatePath("/employee/expenses");
  // Same reason as addExpenseAction: deleting a draw moves the pot.
  revalidatePath("/employee/pl");
}
