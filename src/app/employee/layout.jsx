import { EmployeeShell } from "@/components/employee/EmployeeShell";
import { getCurrentStaff } from "@/lib/auth";
import { countUnreadMessages, listUnreadInbound } from "@/lib/repositories/messages";
import { countUnhandledCalls } from "@/lib/repositories/calls";
import { countNewDeviceInquiries } from "@/lib/repositories/device-inquiries";
import { getAdminSoundMuted } from "@/lib/repositories/settings";
import { isVoiceConfigured } from "@/lib/twilio/access-token";
import { canContactCustomers, canAccess } from "@/domain/access";

/**
 * Employee surface shell. Middleware guarantees the visitor is authenticated
 * before this renders, so we can safely load staff + message context here.
 */
export default async function EmployeeLayout({ children }) {
  const staff = await getCurrentStaff();

  // NOT FETCHED for roles that can't contact customers, rather than fetched
  // and hidden. `notifications` carries message bodies, and props to a Client
  // Component are serialised into the page payload whether or not anything
  // renders them — so hiding the bell would leave customer replies sitting in
  // the page source of someone who may not read them.
  const handlesCustomers = canContactCustomers(staff.role);

  let unread = 0;
  let notifications = [];
  // Missed calls nobody has closed out. A count only — no numbers, no bodies.
  let unhandledCalls = 0;
  if (handlesCustomers) {
    try {
      [unread, notifications, unhandledCalls] = await Promise.all([
        countUnreadMessages(),
        listUnreadInbound(),
        countUnhandledCalls().catch(() => 0),
      ]);
    } catch {
      // DB not reachable yet (e.g. env not configured) — render the shell anyway.
    }
  }

  // Same not-fetched-rather-than-hidden reasoning as handlesCustomers above;
  // both roles can see /leads today, but the gate stays so a future
  // restricted role doesn't get leads streamed to it for free.
  let newLeads = 0;
  if (canAccess(staff.role, "/leads")) {
    newLeads = await countNewDeviceInquiries().catch(() => 0);
  }

  // The /settings "mute for admins" switch. Not even read for another role,
  // so no stored value can ever silence the person whose job is answering.
  const alertSoundMuted = staff.role === "admin" ? await getAdminSoundMuted() : false;

  return (
    <EmployeeShell
      staffName={staff.name}
      staffRole={staff.role}
      alertSoundMuted={alertSoundMuted}
      unreadMessages={unread}
      unhandledCalls={unhandledCalls}
      newLeads={newLeads}
      notifications={notifications}
      // Checked on the server: the credentials are server-only, and asking the
      // browser to register a device we cannot issue a token for just produces
      // a permanently red "phone offline".
      voiceEnabled={isVoiceConfigured() && handlesCustomers}
    >
      {children}
    </EmployeeShell>
  );
}
