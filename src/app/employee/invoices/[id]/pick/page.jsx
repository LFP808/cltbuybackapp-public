import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/repositories/invoices";
import { PickSheet } from "@/components/employee/invoices/PickSheet";

/**
 * Walk the unit and pull an invoice's devices.
 *
 * Under /invoices rather than /inventory because the invoice is what defines
 * the work — and it inherits that route's access rule, which is the same
 * set as /inventory. Checking devices off is local progress and writes
 * nothing, so there is no role gate beyond the route's own.
 */
export default async function PickPage({ params }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  return <PickSheet invoice={invoice} />;
}
