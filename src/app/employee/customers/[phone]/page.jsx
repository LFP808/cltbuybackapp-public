import { notFound } from "next/navigation";
import { CustomerDetail } from "@/components/employee/customers/CustomerDetail";
import { getCustomer } from "@/lib/repositories/customers";
import { isMessagingEnabled } from "@/domain/mode";
import { listLotsByPhone } from "@/lib/repositories/inventory";

export default async function CustomerPage({ params }) {
  const { phone } = await params;
  const customer = await getCustomer(phone);
  if (!customer) notFound();
  // Everything ever checked in from this person — the grade track record
  // and per-item price history that back the next quote. Best-effort: a
  // failed read shows an empty section, not a broken page.
  const lots = await listLotsByPhone(customer.phone).catch(() => []);
  return <CustomerDetail customer={customer} lots={lots} messagingOff={!isMessagingEnabled()} />;
}
