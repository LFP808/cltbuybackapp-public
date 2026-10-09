import { PageTitle, Card } from "@/components/ui";
import { MoneyTabs } from "@/components/employee/pl/MoneyTabs";
import { listInvoices } from "@/lib/repositories/invoices";
import { listLotsComplete } from "@/lib/repositories/inventory";
import { listExpenses } from "@/lib/repositories/expenses";
import { listOrdersComplete } from "@/lib/repositories/orders";

/**
 * The money screens — profit & loss, and cash flow.
 *
 * Admin-only via ROUTE_ACCESS. The dashboard is deliberately not the home for
 * this: it is the shared operational screen every office role opens all day,
 * and what the business nets is not everybody's business.
 */
export default async function ProfitAndLossPage() {
  // A MONEY SCREEN FAILS LOUD OR NOT AT ALL. These reads used to each swallow
  // into [] / null, which on a money page is the worst possible default: a
  // transient failure of listOrders() alone drops every payout out of the
  // totals, and a wrong number here is acted on with money; a missing one is
  // not. So any failure shows the card below instead of a confident zero.
  //
  // Balance snapshots are no longer loaded: the counted-balance card is parked
  // while everything is personally funded (see CashFlowView), and its data
  // with it. listBalanceSnapshots and migration 0022 stay for its return.
  let data = null;
  let dbError = null;
  try {
    // The COMPLETE readers, not the page-capped ones the dashboard uses: a
    // P/L over "the newest 500 orders" is a wrong number the day order 501
    // exists. `truncated` only trips at the paging backstop (50k rows) — by
    // then these totals need real aggregation — but if it ever does, the
    // banner says so instead of presenting a partial sum as the truth.
    const [invoices, lots, expenses, orders] = await Promise.all([
      listInvoices(),
      listLotsComplete(),
      listExpenses(),
      listOrdersComplete(),
    ]);
    data = {
      invoices,
      lots: Array.from(lots),
      expenses,
      orders,
      truncated: Boolean(
        orders.truncated || lots.truncated || invoices.truncated || expenses.truncated,
      ),
    };
  } catch (err) {
    dbError = err?.message || "Could not load the money data.";
  }

  return (
    <div className="max-w-4xl">
      <PageTitle>Money</PageTitle>
      {dbError ? (
        <Card className="border-red-200 text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-red-600">
            The money figures couldn&apos;t be loaded.
          </p>
          <p>
            Nothing is shown rather than a wrong total - a number on this page gets acted on with
            money. Reload; if it keeps happening, check the database connection. ({dbError})
          </p>
        </Card>
      ) : (
        <MoneyTabs
          orders={data.orders}
          invoices={data.invoices}
          lots={data.lots}
          expenses={data.expenses}
          truncated={data.truncated}
        />
      )}
    </div>
  );
}
