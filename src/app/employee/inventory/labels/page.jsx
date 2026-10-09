import { listLotsByIds, listLotsByOrder } from "@/lib/repositories/inventory";
import { getOrder } from "@/lib/repositories/orders";
import { labelsFor, MAX_LABELS } from "@/domain/labels";
import { LabelSheet } from "@/components/employee/inventory/LabelSheet";

/**
 * Print device labels: `?ids=a,b,c` (the grid's ticked rows, in that order)
 * or `?order=<id>` (everything checked in from one order). Both roles — the
 * VA prints labels at the bench — per the /inventory/labels rule.
 *
 * Reads only. The barcode content is the lot's own identity, so there is
 * nothing to validate beyond "is this a lot id": anything that isn't a UUID
 * is dropped before it reaches the query rather than handed to Postgres to
 * reject the whole page over.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LabelsPage({ searchParams }) {
  const { ids, order } = (await searchParams) || {};

  let lots = [];
  let title = "Device labels";
  let backHref = "/inventory";
  let requested = 0;

  if (order && UUID.test(order)) {
    const [owner, orderLots] = await Promise.all([
      getOrder(order).catch(() => null),
      listLotsByOrder(order).catch(() => []),
    ]);
    lots = orderLots;
    requested = orderLots.length;
    if (owner) {
      title = `Labels — ${owner.name}`;
      backHref = `/orders/${owner.id}`;
    }
  } else if (ids) {
    const wanted = String(ids)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID.test(s));
    requested = wanted.length;
    lots = await listLotsByIds(wanted.slice(0, MAX_LABELS)).catch(() => []);
  }

  return (
    <LabelSheet
      labels={labelsFor(lots)}
      title={title}
      backHref={backHref}
      truncated={requested > MAX_LABELS}
    />
  );
}
