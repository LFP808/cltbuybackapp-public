import Link from "next/link";
import { Button, PageTitle } from "@/components/ui";
import { listInvoices } from "@/lib/repositories/invoices";
import { getCurrentStaff } from "@/lib/auth";
import { canAccess } from "@/domain/access";
import { InvoicesList } from "@/components/employee/invoices/InvoicesList";

/**
 * Invoices — the only place stock becomes money. Inventory tracks things;
 * this page owns the documents: create (which ships lots), settle (which
 * realizes P/L), void (which unwinds). They meet only through links.
 */
export default async function InvoicesPage() {
  const { role } = await getCurrentStaff();
  const invoices = await listInvoices();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <PageTitle className="mb-0">Invoices</PageTitle>
        {/* Asks the same ROUTE_ACCESS table the middleware will — today that
            covers admin AND va (the VA builds and prices invoices, per Jaime
            2026-08-13); if that ever tightens, this button disappears with it. */}
        {canAccess(role, "/invoices/new") && (
          <span className="ml-auto">
            <Button as={Link} href="/invoices/new" size="sm">
              New invoice
            </Button>
          </span>
        )}
      </div>
      <InvoicesList invoices={invoices} />
    </div>
  );
}
