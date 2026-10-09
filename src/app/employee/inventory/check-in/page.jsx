import { redirect } from "next/navigation";

/**
 * A check-in belongs to an order, so the real screen is /inventory/check-in/<id>.
 * This segment had a loading.jsx and no page, which made the bare URL a 404 —
 * reachable by trimming an id off the address bar, and by any half-typed link.
 * The queue is where you pick which order to check in, so that's where this goes.
 */
export default async function CheckInIndexPage() {
  redirect("/inventory");
}
