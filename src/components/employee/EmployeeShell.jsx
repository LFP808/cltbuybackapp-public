"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { BreadcrumbAuto } from "./BreadcrumbAuto";
import { InboundAlerts } from "./InboundAlerts";
import { LeadAlerts } from "./LeadAlerts";
import { StaffProvider } from "./StaffContext";
import { NotificationBell } from "./NotificationBell";
import { Softphone, VoiceStatus } from "./voice/Softphone";
import { Button, TooltipProvider } from "@/components/ui";
import { cn } from "@/lib/cn";
import { canAccess, canContactCustomers } from "@/domain/access";

/**
 * Employee surface chrome: fixed sidebar + a sticky top bar with breadcrumbs,
 * and a content region that gently animates in on each navigation. Owns the
 * mobile sidebar open/close state.
 */
const COLLAPSE_KEY = "cltbb.sidebarCollapsed";

export function EmployeeShell({
  staffName,
  staffRole,
  alertSoundMuted = false,
  unreadMessages,
  unhandledCalls = 0,
  newLeads = 0,
  notifications = [],
  voiceEnabled = false,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Collapsed is the default, so the first paint matches the server and the
  // rail never flashes wide before settling.
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  // Read the saved preference after mount — localStorage doesn't exist during
  // SSR, and reading it in the initial state would cause a hydration mismatch.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "false") setCollapsed(false);
    } catch {
      /* private mode / storage disabled — the default is fine */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* non-fatal: the choice just won't outlive this tab */
      }
      return next;
    });
  }

  return (
    <TooltipProvider delayDuration={250}>
      <StaffProvider name={staffName} role={staffRole}>
        {/* Independent of InboundAlerts — its own socket, its own chime,
            gated on who may see leads rather than who answers customers. */}
        <LeadAlerts enabled={canAccess(staffRole, "/leads")} muted={alertSoundMuted} />
        {/* Only roles that answer customers get the chime — and its socket.
            `muted` is the /settings switch (admins only): it takes the SOUND
            away from both listeners and leaves the sockets running. */}
        <InboundAlerts enabled={canContactCustomers(staffRole)} muted={alertSoundMuted}>
          {/* One device for the whole session. Mounted here rather than on the
            calls page so a call survives navigating to the customer's orders
            mid-conversation, which is what someone on a call does. */}
          <Softphone enabled={voiceEnabled}>
            {/* White page like the marketing site; bg-bg is now only the
                sunken gray for hovers and recessed panels. */}
            <div className="min-h-screen bg-white">
              <Sidebar
                staffName={staffName}
                staffRole={staffRole}
                unreadMessages={unreadMessages}
                unhandledCalls={unhandledCalls}
                newLeads={newLeads}
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapsed}
              />

              <div
                className={cn(
                  "transition-[margin] duration-200",
                  // The margin is chrome too: without print:ml-0 a printed page
                  // keeps a sidebar-sized blank gutter where the rail was.
                  collapsed ? "lg:ml-[4.5rem]" : "lg:ml-64",
                  "print:ml-0",
                )}
              >
                <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-white/80 px-4 backdrop-blur-md print:hidden lg:px-8">
                  <button
                    className="rounded-md p-1.5 text-muted hover:bg-bg hover:text-ink lg:hidden"
                    onClick={() => setSidebarOpen(true)}
                    aria-label="Open menu"
                  >
                    <Menu size={18} />
                  </button>
                  <BreadcrumbAuto role={staffRole} />
                  <div className="ml-auto flex items-center gap-2">
                    <VoiceStatus />
                    {/* The layout doesn't even fetch these for a role that
                        can't answer them. */}
                    {canContactCustomers(staffRole) && (
                      <NotificationBell
                        notifications={notifications}
                        unreadCount={unreadMessages}
                      />
                    )}
                    {/* Same gate as the sidebar — no point offering a shortcut the
                  middleware would bounce. */}
                    {canAccess(staffRole, "/new") && (
                      <Button as={Link} href="/new" size="sm">
                        <Plus size={15} /> New
                      </Button>
                    )}
                  </div>
                </header>

                {/* print:p-0 and print:animate-none are for the printed pages
                    (invoice, device labels): the padding is chrome, and the
                    enter animation leaves a transform on the wrapper — and a
                    transformed ancestor is the containing block for any
                    absolutely positioned descendant, which pinned the 4x2
                    label sheet inside this padding instead of at the page
                    origin, i.e. off the label. */}
                <main className="px-4 py-6 lg:px-8 print:p-0">
                  {/* keyed on path so content re-animates on navigation */}
                  <div key={pathname} className="animate-enter print:animate-none">
                    {children}
                  </div>
                </main>
              </div>
            </div>
          </Softphone>
        </InboundAlerts>
      </StaffProvider>
    </TooltipProvider>
  );
}
