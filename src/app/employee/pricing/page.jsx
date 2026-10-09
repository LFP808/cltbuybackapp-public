import { PageTitle } from "@/components/ui";
import { listAllCatalogItems } from "@/lib/repositories/catalog";
import { CatalogManager } from "@/components/employee/CatalogManager";

/**
 * The Item Catalog — what we buy, without prices. This route was the Pricing
 * Guide; the reference prices were removed on purpose (pricing is negotiated
 * per person and the order form already ignored them), leaving the list
 * itself, now DB-backed and editable so off-list items can be added without
 * a deploy. The route path stays /pricing so nothing bookmarked breaks.
 */
export default async function ItemCatalogPage() {
  const items = await listAllCatalogItems();
  return (
    <div className="max-w-3xl">
      <PageTitle>Item Catalog</PageTitle>
      <p className="mb-4 text-[13px] italic text-muted">
        The items the order form and check-in screen can pick from. Prices live on orders and
        check-ins, never here — what we pay is negotiated per person.
      </p>
      <CatalogManager items={items} />
    </div>
  );
}
