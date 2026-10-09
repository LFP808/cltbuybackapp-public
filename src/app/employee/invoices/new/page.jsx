import { PageTitle } from "@/components/ui";
import { listLotsInStock } from "@/lib/repositories/inventory";
import { listBuyers } from "@/lib/repositories/buyers";
import { InvoiceBuilder } from "@/components/employee/invoices/InvoiceBuilder";

/**
 * Build an invoice from what's on the shelf. The pick list IS the lot list —
 * lots are already the invoice's grain (item + carrier + grade), so
 * selecting stock and pricing each line per unit is the whole job.
 */
export default async function NewInvoicePage() {
  const [lots, buyers] = await Promise.all([listLotsInStock(), listBuyers()]);
  return (
    <div>
      <PageTitle>New invoice</PageTitle>
      <InvoiceBuilder lots={lots} buyers={buyers} />
    </div>
  );
}
