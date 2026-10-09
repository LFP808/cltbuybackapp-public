"use client";

import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  MessageSquare,
  PhoneCall,
  Calendar,
  ClipboardList,
  ReceiptText,
  Inbox,
  Wallet,
  UsersRound,
  BookOpen,
  TrendingUp,
  Settings,
  X,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/domain/roles";
import { navFor } from "@/domain/access";
import {
  BrandLockup,
  Brandmark,
  Avatar,
  Tooltip,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Spinner,
} from "@/components/ui";

/**
 * Frosts the screen and centres a spinner while a navigation is in flight.
 *
 * MUST render inside the <Link> — useLinkStatus reads the pending state of the
 * link above it, and returns a permanent false anywhere else.
 *
 * This covers the gap loading.jsx cannot. Middleware refreshes the Supabase
 * session and reads the role on every request — two round trips, ~200ms warm —
 * and all of that happens BEFORE Next resolves the route. Nothing has rendered,
 * so nothing has suspended, so a Suspense fallback has nothing to fall back
 * from: the old page just sits there looking ignored. Pending starts on click,
 * which is the only thing that covers that window.
 *
 * Portalled to <body> rather than rendered in place: the overlay is fixed to
 * the viewport, and a fixed child of a transformed ancestor positions against
 * that ancestor instead. The sidebar slides on a transform, so in place it
 * would be a spinner centred on the sidebar.
 *
 * Shown with no delay, unlike RouteSpinner. Every navigation costs at least
 * that round trip, so there is no "fast enough to not bother" case to protect
 * against — and feedback that arrives after a beat of nothing is the exact
 * complaint this fixes.
 */
function NavPendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return createPortal(
    // Transparent to clicks on purpose. The frost is feedback, not a modal:
    // someone who clicks the wrong item should be able to correct it in the
    // same beat rather than wait out a navigation they no longer want.
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/45 backdrop-blur-[3px]">
      <Spinner size={30} label="Loading page" />
    </div>,
    document.body,
  );
}

// In the order the work happens: booked -> bought -> on the shelf -> sold.
// The header's "New Order" button covers intake, so it isn't repeated here.
// No "Orders" entry: /orders is only a redirect home (the dashboard IS the
// orders list), so a nav item for it reads as a broken link. The route rule
// in domain/access.js survives — /orders/[id] detail pages live under it.
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid, exact: true },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/inventory", label: "Inventory", icon: ClipboardList },
  { href: "/invoices", label: "Invoices", icon: ReceiptText },
  { href: "/leads", label: "Leads", icon: Inbox },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/pl", label: "P/L", icon: TrendingUp },
  { href: "/pricing", label: "Item Catalog", icon: BookOpen },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Employee navigation.
 *
 * Two independent behaviours, one component:
 *   mobile  — off-canvas drawer, always full width, toggled by `open`.
 *   desktop — a permanent rail that collapses to icons, toggled by `collapsed`.
 *
 * `collapsed` is deliberately ignored below `lg`: on a phone the sidebar is
 * already hidden, and an icon-only drawer would be a worse version of the menu
 * that's there. Every row stays a real link in both states, so collapsing
 * changes what you see, never what you can click.
 */
export function Sidebar({
  staffName,
  staffRole,
  unreadMessages = 0,
  unhandledCalls = 0,
  newLeads = 0,
  open,
  onClose,
  collapsed = false,
  onToggleCollapse,
}) {
  const pathname = usePathname();

  const isActive = (item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));
  // Three queues wear a count: replies waiting, callers waiting, leads not yet
  // worked. All three shrink as the work is done, which is what makes a
  // number worth showing at all.
  const badgeFor = (item) => {
    if (item.href === "/messages" && unreadMessages > 0) return unreadMessages;
    if (item.href === "/calls" && unhandledCalls > 0) return unhandledCalls;
    if (item.href === "/leads" && newLeads > 0) return newLeads;
    return null;
  };

  // Same table the middleware gates on, so the nav can't offer a link that
  // would just bounce the user back. This hides; the middleware enforces.
  const items = navFor(staffRole, NAV);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[55] bg-ink/30 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-[60] flex h-screen w-64 flex-col border-r border-line bg-white print:hidden",
          "transition-[transform,width] duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-[4.5rem]" : "lg:w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 py-4",
            collapsed ? "lg:justify-center lg:px-0" : "justify-between px-5",
            "px-5",
          )}
        >
          {/* Full lockup when open; just the mark once collapsed. */}
          <span className={cn(collapsed && "lg:hidden")}>
            <BrandLockup />
          </span>
          {collapsed && (
            <span className="hidden lg:block">
              <Brandmark />
            </span>
          )}

          <button
            className="rounded-md p-1 text-muted hover:bg-bg hover:text-ink lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Desktop-only collapse toggle. */}
        <div
          className={cn("hidden lg:flex", collapsed ? "justify-center px-0" : "justify-end px-4")}
        >
          <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
            <button
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-bg hover:text-ink"
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </Tooltip>
        </div>

        <nav
          className={cn(
            "flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden py-2",
            collapsed ? "lg:px-2" : "",
            "px-3",
          )}
        >
          <div
            className={cn(
              "px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted/70",
              collapsed && "lg:hidden",
            )}
          >
            Operations
          </div>

          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = badgeFor(item);

            const link = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-label={item.label}
                title={undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg py-2 text-[13.5px] font-medium transition-colors",
                  collapsed ? "lg:justify-center lg:px-0" : "",
                  "px-2.5",
                  active ? "bg-accent-l text-accent" : "text-ink/70 hover:bg-bg hover:text-ink",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full border-l-2 border-accent" />
                )}
                <NavPendingOverlay />
                <span className="relative flex-shrink-0">
                  <Icon
                    size={16}
                    className={cn(active ? "text-accent" : "text-muted group-hover:text-ink")}
                  />
                  {/* Collapsed has no room for a count, but losing the unread
                      signal entirely would hide the one thing that needs
                      attention — so it becomes a dot. */}
                  {badge && collapsed && (
                    <span className="absolute -right-1 -top-1 hidden h-2 w-2 rounded-full bg-accent ring-2 ring-white lg:block" />
                  )}
                </span>
                <span className={cn("flex-1", collapsed && "lg:hidden")}>{item.label}</span>
                {badge && (
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10.5px] font-bold text-white",
                      collapsed && "lg:hidden",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );

            // A collapsed icon with no label needs a name on hover, or the rail
            // becomes a guessing game.
            return collapsed ? (
              <Tooltip
                key={item.href}
                label={badge ? `${item.label} (${badge})` : item.label}
                side="right"
              >
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>

        <div className={cn("border-t border-line p-3", collapsed && "lg:px-2")}>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg py-2 text-left outline-none transition-colors hover:bg-bg focus-visible:ring-2 focus-visible:ring-accent/20",
                collapsed ? "lg:justify-center lg:px-0" : "",
                "px-2",
              )}
              aria-label={`${staffName} — account menu`}
            >
              <Avatar initial={(staffName || "?").trim()[0]?.toUpperCase() || "?"} size="sm" />
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <div className="truncate text-[13px] font-semibold text-ink">{staffName}</div>
                <div className="text-[11px] text-muted">{roleLabel(staffRole)}</div>
              </div>
              <ChevronsUpDown size={15} className={cn("text-muted", collapsed && "lg:hidden")} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-[13rem]">
              <DropdownMenuLabel>
                {staffName} · {roleLabel(staffRole)}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action="/auth/signout" method="post">
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full">
                    <LogOut size={15} /> Sign out
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
