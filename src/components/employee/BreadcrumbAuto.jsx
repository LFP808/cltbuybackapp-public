"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui";
import { fmtPhone } from "@/domain/format";
import { homeFor } from "@/domain/access";

const LABELS = {
  customers: "Customers",
  messages: "Messages",
  new: "New Order",
  calls: "Calls",
  orders: "Order",
  message: "Message",
  calendar: "Calendar",
  inventory: "Inventory",
  invoices: "Invoices",
  "check-in": "Check In",
  print: "Print",
  pricing: "Item Catalog",
  expenses: "Expenses",
  pl: "P/L",
  team: "Team",
  settings: "Settings",
};

/**
 * Segments that name a section but have no page worth linking of their own.
 *
 * /orders/<id> exists; /orders only redirects to the dashboard, so linking the
 * crumb sends people on a bounce — the kind of dead end you only find by
 * clicking your own breadcrumbs.
 */
const NO_INDEX_PAGE = new Set(["orders"]);

/** Human label for a URL segment (formats a dynamic phone/id tail). */
function labelFor(segment, prevSegment) {
  // "new" is order intake everywhere except under /invoices.
  if (segment === "new" && prevSegment === "invoices") return "New Invoice";
  if (LABELS[segment]) return LABELS[segment];
  if (/^\d{10}$/.test(segment)) return fmtPhone(segment); // customer phone
  if (prevSegment === "orders") return "Detail"; // order id (uuid)
  // Any other uuid tail (an invoice, a check-in's order) reads as Detail too —
  // a raw uuid in a breadcrumb helps nobody.
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return "Detail";
  return decodeURIComponent(segment);
}

/**
 * Breadcrumb trail derived from the current path. Always rooted at the role's
 * home; the last crumb is the current page.
 *
 * @param {{ role?: string }} props role picks the home the trail is rooted at
 *   (homeFor), so the first crumb never points somewhere the role can't open.
 */
export function BreadcrumbAuto({ role }) {
  const pathname = usePathname();
  const home = homeFor(role);
  const homeLabel = home === "/calendar" ? "Calendar" : "Dashboard";
  // Drop the internal surface prefix if a path-based URL ever leaks through.
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => s !== "employee");

  // At the home/dashboard there's nowhere to go "up" — show no breadcrumbs.
  if (segments.length === 0) return null;

  const crumbs = [];
  let href = "";
  segments.forEach((seg, i) => {
    href += `/${seg}`;
    crumbs.push({
      label: labelFor(seg, segments[i - 1]),
      href,
      linkable: !NO_INDEX_PAGE.has(seg),
    });
  });

  // If a role's home ever moves onto a listed page, the trail would read
  // "Home › Home" — the same destination twice, which looks like a bug rather
  // than a hierarchy. Drop the crumb that repeats home.
  if (crumbs.length && crumbs[0].href === home) crumbs.shift();
  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href={home} className="inline-flex items-center gap-1.5">
            <Home size={13} /> {homeLabel}
          </BreadcrumbLink>
        </BreadcrumbItem>

        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast || !crumb.linkable ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
