import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, PageTitle } from "@/components/ui";
import { getOrder } from "@/lib/repositories/orders";
import { listLotsByOrder } from "@/lib/repositories/inventory";
import { listCatalogItems } from "@/lib/repositories/catalog";
import { getGrades } from "@/lib/repositories/settings";
import { isSickwTestMode } from "@/lib/sickw/client";
import { needsCheckIn } from "@/domain/inventory";
import { isDeleted } from "@/domain/orders";
import { currency } from "@/domain/format";
import { CheckInForm } from "@/components/employee/inventory/CheckInForm";

/**
 * Raised to cover sickwLookupAction's own SICKW_TIMEOUT_MS (50s, see
 * lib/sickw/client.js) with a margin — otherwise Vercel's default platform
 * cutoff kills a slow-but-still-billable Sickw lookup before that clean
 * timeout error ever gets a chance to fire.
 */
export const maxDuration = 60;

/**
 * Count one order's devices into inventory. The form pre-seeds from what the
 * order PROMISED, because check-in is reconciliation, not data entry — the
 * employee confirms counts, IMEIs, carriers, grades, and the price actually
 * paid per row.
 */
export default async function CheckInPage({ params }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  // Already counted: show what it became rather than a second entry form —
  // re-entering would double the inventory.
  if (order.checkedInAt) {
    const lots = await listLotsByOrder(order.id);
    return (
      <div className="max-w-2xl">
        <PageTitle>Checked in — {order.name}</PageTitle>
        <Card>
          <p className="text-[13px] text-muted">
            Checked in on {new Date(order.checkedInAt).toLocaleString()}.
          </p>
          <div className="mt-2 divide-y divide-line">
            {lots.map((lot) => (
              <div key={lot.id} className="flex justify-between gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate">
                  {lot.item} ×{lot.quantity}
                </span>
                <span className="font-mono text-muted">{currency(lot.cog * lot.quantity)}</span>
              </div>
            ))}
            {lots.length === 0 && (
              <p className="py-1.5 text-[13px] text-muted">No lots were recorded.</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button as={Link} href="/inventory" variant="ghost" size="sm">
              Back to Inventory
            </Button>
            {/* Labels right after the count, while the devices are still on
                the bench in front of whoever counted them. */}
            {lots.length > 0 && (
              <Button
                as="a"
                href={`/inventory/labels?order=${order.id}`}
                target="_blank"
                rel="noopener"
                variant="ghost"
                size="sm"
              >
                Print labels
              </Button>
            )}
            <Button as={Link} href={`/orders/${order.id}`} size="sm">
              View order
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!needsCheckIn(order)) {
    return (
      <div className="max-w-2xl">
        <PageTitle>Check in — {order.name}</PageTitle>
        <Card>
          <p className="text-[13px] text-muted">
            {isDeleted(order)
              ? "This order was deleted - it is kept as a record only, and nothing from it goes into inventory."
              : "This order hasn't been bought yet — mark it bought first, then check the devices in."}
          </p>
          <Button as={Link} href={`/orders/${order.id}`} size="sm" className="mt-3">
            Open the order
          </Button>
        </Card>
      </div>
    );
  }

  // Catalog failure degrades to the seed list (the picker still works).
  // getGrades degrades internally (missing table/row → DEFAULT_GRADES), so no
  // catch here — the form always gets a non-empty ladder.
  const [catalog, grades] = await Promise.all([listCatalogItems().catch(() => []), getGrades()]);
  return (
    <CheckInForm
      order={order}
      catalog={catalog}
      grades={grades}
      // Env is server-only; the form says "canned data" so a clean Sickw
      // answer on a dev box is never mistaken for a real report.
      sickwTestMode={isSickwTestMode()}
    />
  );
}
