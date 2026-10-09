"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canAccess } from "@/domain/access";
import { validateSnapshot } from "@/domain/cash";
import { saveBalanceSnapshot } from "@/lib/repositories/balances";

/**
 * Server actions for the money screens. Same contract as every action file:
 * EXPECTED FAILURES ARE RETURNED via fail(), throwing is reserved for genuine
 * faults (see app/employee/actions.js for the long version of why).
 *
 * Middleware already keeps non-admins off /pl, but an action is a public POST
 * endpoint in its own right, so this re-checks the same ROUTE_ACCESS rule it is
 * reachable from — the gate and the door match.
 */
export async function saveBalanceSnapshotAction(input) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/pl")) return fail("You can't record balances.");

  const errors = validateSnapshot(input);
  if (Object.keys(errors).length) {
    return fail("Check the highlighted fields.", { fieldErrors: errors });
  }

  const saved = await saveBalanceSnapshot({
    asOf: input.asOf,
    bank: round(input.bank),
    cash: round(input.cash),
    note: String(input.note || "").trim(),
    createdBy: staff.name,
  });

  // The repository answers null rather than throwing when the
  // balance_snapshots table is missing. Said plainly, because "nothing
  // happened" with no reason is the failure people spend an afternoon on.
  if (!saved) {
    return fail(
      "Balance snapshots need the balance_snapshots table - run the migrations in supabase/migrations first.",
    );
  }

  revalidatePath("/employee/pl");
  return { snapshot: saved };
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
