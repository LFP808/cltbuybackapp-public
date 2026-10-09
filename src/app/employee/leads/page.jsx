import { PageTitle } from "@/components/ui";
import { listDeviceInquiries } from "@/lib/repositories/device-inquiries";
import { LeadsManager } from "@/components/employee/leads/LeadsManager";
import { isMessagingEnabled } from "@/domain/mode";

/**
 * Leads from the marketing site's "sell your device" quote wizard. Both
 * roles triage — same job as answering texts/calls — via ROUTE_ACCESS.
 */
export default async function LeadsPage() {
  const inquiries = await listDeviceInquiries();
  return (
    <div className="max-w-4xl">
      <PageTitle>Leads</PageTitle>
      <p className="mb-4 text-[13px] italic text-muted">
        Device inquiries from the website. Text or call to quote a price, then mark where things
        stand here.
      </p>
      <LeadsManager inquiries={inquiries} messagingOff={!isMessagingEnabled()} />
    </div>
  );
}
