import { PageTitle, Card } from "@/components/ui";
import { OrdersList } from "@/components/employee/OrdersList";
import { OverviewPanel } from "@/components/employee/dashboard/OverviewPanel";
import { AttentionPanel } from "@/components/employee/dashboard/AttentionPanel";
import { ViewToggle } from "@/components/employee/dashboard/ViewToggle";
import { DashboardSettings } from "@/components/employee/dashboard/DashboardSettings";
import { listOrders } from "@/lib/repositories/orders";
import { listCustomers } from "@/lib/repositories/customers";
import { listInvoices } from "@/lib/repositories/invoices";
import { listLotsInStock } from "@/lib/repositories/inventory";
import { listCalls } from "@/lib/repositories/calls";
import { requireStaff, getCurrentStaff } from "@/lib/auth";
import { canSeeOverview } from "@/domain/access";
import { computeDashboardMetrics, resolveRange } from "@/domain/metrics";
import { buildAttention } from "@/domain/attention";

export default async function DashboardPage({ searchParams }) {
  const sp = await searchParams;
  const range = resolveRange({ range: sp?.range, from: sp?.from, to: sp?.to });
  const hidden = (sp?.hide || "").split(",").filter(Boolean);

  // THE VIEW IS A PERMISSION, so it is resolved here and not just hidden in the
  // toggle. The Overview is the business's numbers — leads, repeat rate, payout
  // totals, pipeline — and a VA reads none of it (Jaime, 2026-07-30). Middleware
  // cannot help: `?view=overview` is a query param on a path they may open.
  //
  // A VA who follows an old link is given the Orders list rather than an error.
  // Nothing was denied them that they knew they had, and the alternative is a
  // 403 on their own home page.
  const role = (await getCurrentStaff()).role;
  const overview = sp?.view === "overview" && canSeeOverview(role);

  let content;
  let attention = [];
  let dbError = null;
  try {
    const staff = await requireStaff();
    if (overview) {
      const [shipments, customers] = await Promise.all([listOrders(), listCustomers()]);
      const metrics = computeDashboardMetrics(shipments, customers, range);
      content = <OverviewPanel metrics={metrics} hidden={hidden} />;
      attention = await gatherAttention(shipments, staff.role);
    } else {
      const orders = await listOrders();
      content = <OrdersList shipments={orders} truncated={orders.truncated} />;
      attention = await gatherAttention(orders, staff.role);
    }
  } catch (err) {
    dbError = err?.message || "Could not load data.";
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <PageTitle>{overview ? "Overview" : "Orders"}</PageTitle>
          <p className="mt-1 text-[13.5px] text-muted">
            {overview
              ? "Leads, repeat customers, payouts, and pipeline at a glance."
              : "Meetups and walk-ins, through to payout."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overview && (
            <DashboardSettings
              rangeKey={range.key}
              rangeLabel={range.label}
              from={sp?.from || ""}
              to={sp?.to || ""}
              hidden={hidden}
            />
          )}
          {canSeeOverview(role) && <ViewToggle active={overview ? "overview" : "shipments"} />}
        </div>
      </div>

      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Database not connected yet.</p>
          <p>
            Set your Supabase environment variables and run the migrations in{" "}
            <code>supabase/migrations</code>. ({dbError})
          </p>
        </Card>
      ) : (
        <>
          <AttentionPanel sections={attention} />
          {content}
        </>
      )}
    </div>
  );
}

/**
 * The worklist, from the orders this page already loaded plus the three tables
 * it doesn't.
 *
 * Each extra read is `.catch(() => [])` on its own: a dashboard that refuses to
 * render because the call log hiccuped is a worse outcome than one missing a
 * row from its attention list. The orders are threaded through rather than
 * re-queried — they are the same rows, and asking twice is a second round trip
 * for an identical answer.
 */
async function gatherAttention(orders, role) {
  const [invoices, lots, calls] = await Promise.all([
    listInvoices().catch(() => []),
    listLotsInStock().catch(() => []),
    listCalls().catch(() => []),
  ]);
  return buildAttention({ orders, invoices, lots, calls, role });
}
