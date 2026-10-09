import { PageTitle } from "@/components/ui";
import { listExpenses } from "@/lib/repositories/expenses";
import { ExpensesManager } from "@/components/employee/expenses/ExpensesManager";

/**
 * The expense ledger — what it costs to run the operation: ad spend, payroll,
 * packing supplies. Admin-only via ROUTE_ACCESS; middleware checks before the
 * rewrite, so nobody else reaches this render.
 */
export default async function ExpensesPage() {
  const expenses = await listExpenses();
  return (
    <div className="max-w-4xl">
      <PageTitle>Expenses &amp; Draws</PageTitle>
      <p className="mb-4 text-[13px] italic text-muted">
        The running costs of the business, plus any profit taken out as owner draws. Customer
        payouts stay on their orders — this is everything an order can&apos;t carry.
      </p>
      <ExpensesManager expenses={expenses} />
    </div>
  );
}
