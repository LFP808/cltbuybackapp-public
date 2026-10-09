import { RouteSpinner } from "@/components/ui";

/**
 * Shown while an employee route resolves its server data.
 *
 * THIS FILE IS RE-EXPORTED BY EVERY CHILD ROUTE (calendar/loading.jsx and the
 * rest). One boundary up here is not enough: it covers the first entry into the
 * segment, but going from /customers to /messages changes only the child, and a
 * boundary that has already resolved does not fall back a second time. The
 * result was a blank content area for as long as the new page took to load.
 * Each segment therefore declares its own, all pointing here so the look of it
 * only ever lives in one place.
 *
 * The sidebar and header live in the layout, so they stay put and only the
 * content area swaps.
 */
export default function EmployeeLoading() {
  return <RouteSpinner />;
}
