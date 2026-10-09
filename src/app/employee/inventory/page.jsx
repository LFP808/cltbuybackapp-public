import { PageTitle } from "@/components/ui";
import { listOrders } from "@/lib/repositories/orders";
import { listLots } from "@/lib/repositories/inventory";
import { getGrades } from "@/lib/repositories/settings";
import { needsCheckIn } from "@/domain/inventory";
import { getCurrentStaff } from "@/lib/auth";
import { canAccess, canWrite } from "@/domain/access";
import { InventoryTabs } from "@/components/employee/inventory/InventoryTabs";

/**
 * Raised to cover sickwLookupAction's own SICKW_TIMEOUT_MS (50s, see
 * lib/sickw/client.js) with a margin, same reason check-in's page sets it —
 * the admin "Re-check IMEI" button in LotEditDialog calls that same action
 * from here.
 */
export const maxDuration = 60;

/**
 * Inventory: two tabs, nothing else. Pending Check-in is the work queue —
 * received/paid orders whose contents haven't been counted; Inventory is the
 * sheet-like grid of every lot. Both are server-fetched here and filtered in
 * the browser, the same shape as the orders dashboard.
 */
export default async function InventoryPage() {
  const { role } = await getCurrentStaff();
  // grades feed the row-click edit dialog's picker; getGrades degrades to
  // DEFAULT_GRADES on its own, so no catch.
  const [orders, lots, grades] = await Promise.all([listOrders(), listLots(), getGrades()]);
  const queue = orders
    .filter(needsCheckIn)
    // Oldest first: the top row is the buy that has waited longest.
    .sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div>
      <PageTitle>Inventory</PageTitle>
      {/* A VA reads this sheet and changes nothing on it (READ_ONLY_AREAS), so
          the row-click editor and the dispose path are not rendered for them.
          The actions refuse it too — this is so nobody is handed a control
          whose only function is to say no. */}
      <InventoryTabs
        queue={queue}
        lots={lots}
        grades={grades}
        truncated={Boolean(lots.truncated)}
        canEdit={canWrite(role, "/inventory")}
        canCheckIn={canAccess(role, "/inventory/check-in")}
        isAdmin={role === "admin"}
      />
    </div>
  );
}
