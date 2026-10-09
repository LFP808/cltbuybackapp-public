import { PageTitle } from "@/components/ui";
import { NewOrderForm } from "@/components/employee/NewOrderForm";
import { listAppointments } from "@/lib/repositories/orders";
import { getBookingSchedule, getPaymentMethods, getGrades } from "@/lib/repositories/settings";
import { listCatalogItems } from "@/lib/repositories/catalog";
import { officeAddressLine } from "@/lib/business";

export default async function NewOrderPage({ searchParams }) {
  const { phone, name } = await searchParams;
  const prefill = phone || name ? { phone: phone || "", name: name || "" } : undefined;
  // The DB-backed catalog; the form falls back to the static seed if this
  // read fails, so a catalog outage never blocks taking an order.
  const catalog = await listCatalogItems().catch(() => []);
  // Upcoming bookings for the slot picker. Best effort — a failed read shows
  // an empty day rather than blocking intake; the server action still runs
  // the real double-book check at submit.
  const appointments = await listAppointments().catch(() => []);
  // The admin-set slot window; falls back to 8am-8pm inside the read.
  const bookingSchedule = await getBookingSchedule();
  // The admin-set payout methods for the walk-in payout card; degrades to the
  // domain constant inside the read.
  const paymentMethods = await getPaymentMethods();
  // The condition ladder for the per-item Condition picker (same `grades`
  // setting check-in uses); degrades to DEFAULT_GRADES inside the read.
  const grades = await getGrades();
  // The meetup address as the admin set it on /settings (env fallback) —
  // composed here, not in the form, because the read is server-only.
  const officeLine = await officeAddressLine();

  return (
    <div>
      <PageTitle>New Order</PageTitle>
      <NewOrderForm
        prefill={prefill}
        officeLine={officeLine}
        catalog={catalog}
        appointments={appointments}
        bookingSchedule={bookingSchedule}
        paymentMethods={paymentMethods}
        grades={grades}
      />
    </div>
  );
}
