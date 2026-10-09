import { PageTitle, Card } from "@/components/ui";
import { CustomersList } from "@/components/employee/customers/CustomersList";
import { listCustomers, listCustomerTags } from "@/lib/repositories/customers";
import { getCurrentStaff } from "@/lib/auth";

export default async function CustomersPage() {
  // Deleting a contact is admin-only; the list hides the control from
  // everyone else and the action refuses them anyway.
  const staff = await getCurrentStaff();
  let customers = [];
  let tags = [];
  let dbError = null;
  try {
    [customers, tags] = await Promise.all([listCustomers(), listCustomerTags()]);
  } catch (err) {
    dbError = err?.message || "Could not load customers.";
  }

  return (
    <div>
      <PageTitle>Customers</PageTitle>
      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Database not connected yet.</p>
          <p>Configure Supabase and run the migrations to load customers. ({dbError})</p>
        </Card>
      ) : (
        <CustomersList customers={customers} tags={tags} canDelete={staff.role === "admin"} />
      )}
    </div>
  );
}
