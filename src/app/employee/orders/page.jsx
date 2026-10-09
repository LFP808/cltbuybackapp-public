import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { homeFor } from "@/domain/access";

/**
 * /orders has always been in ROUTE_ACCESS (the detail pages live under it) but
 * never had a page of its own, so typing the URL — or following a stale link —
 * produced a 404 on a path the app says you may open.
 *
 * The orders LIST is the dashboard's default view, so this sends people there
 * rather than duplicating it. Routed through homeFor() so the redirect and
 * the role's home page can never disagree.
 */
export default async function OrdersIndexPage() {
  const staff = await getCurrentStaff();
  redirect(homeFor(staff.role));
}
