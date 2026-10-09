import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/repositories/invoices";
import { getPaymentMethods } from "@/lib/repositories/settings";
import { InvoiceDetail } from "@/components/employee/invoices/InvoiceDetail";
import { getCurrentStaff } from "@/lib/auth";
import { canWrite } from "@/domain/access";

export default async function InvoicePage({ params }) {
  const { id } = await params;
  const [invoice, { role }, paymentMethods] = await Promise.all([
    getInvoice(id),
    getCurrentStaff(),
    // The admin-set list feeds the settle form's paid-method picker; the read
    // degrades to the built-in default per settings.js.
    getPaymentMethods(),
  ]);
  if (!invoice) notFound();
  // canWrite gates the money controls. READ_ONLY_AREAS is empty today — the
  // VA builds AND settles invoices — but the page keeps asking so a future
  // tightening hides the buttons the actions would refuse anyway.
  return (
    <InvoiceDetail
      invoice={invoice}
      canEdit={canWrite(role, "/invoices")}
      paymentMethods={paymentMethods}
    />
  );
}
