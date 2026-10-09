import { json, handle, requireApiStaff, ApiError } from "@/lib/api";
import { listOrdersByPhone } from "@/lib/repositories/orders";
import { canAccess } from "@/domain/access";
import { isOpen } from "@/domain/orders";
import { normPhone } from "@/domain/format";

/**
 * "Do we already know this number?" — asked while an employee is still typing
 * an order, so the answer arrives before the customer hangs up.
 *
 * Two different things are worth knowing at intake:
 *
 *   - an OPEN order on this number, which usually means a duplicate: the
 *     customer called twice, or two staff took the same call, and one person
 *     does not need two meetups booked.
 *   - a PAST order, which is not a problem at all — it just means we already
 *     know them and their name can prefill.
 *
 * "Open" is the shared predicate, NOT `status !== "paid"`. Counting a cancelled
 * order as open made this warn about a duplicate that createOrderAction — which
 * uses countOpenOrdersForPhone — then refused to block, so the two halves of one
 * feature disagreed.
 *
 * Reads through the repository so role scoping and the row mapping are the same
 * ones every other read uses. The previous hand-written query applied neither,
 * and returned a customer's details to any signed-in role — including ones
 * that cannot open the intake form this exists to serve.
 */
export const GET = handle(async (_request, { params }) => {
  // Gated on the page this serves, not on /messages: it exists for the intake
  // form, so tying it to anything else lets the two drift apart silently — and
  // NewOrderForm treats any non-OK response as "unknown number", so a wrong
  // gate would disable the duplicate check with no error anywhere.
  const staff = await requireApiStaff();
  if (!canAccess(staff.role, "/new")) {
    throw new ApiError("Not allowed.", 403);
  }

  const { phone: raw } = await params;
  const phone = normPhone(raw);
  if (phone.length !== 10) throw new ApiError("A 10-digit phone number is required.", 400);

  // Counted over ALL of them, not a recent page. countOpenOrdersForPhone —
  // which createOrderAction actually gates on — has no limit, so capping first
  // would hide an older open order from the warning and then have the server
  // refuse the create anyway.
  const orders = await listOrdersByPhone(phone);
  const open = orders.filter(isOpen);
  const mostRecent = orders[0] || null;

  return json({
    known: orders.length > 0,
    name: mostRecent?.name ?? null,
    orderCount: orders.length,
    openOrders: open.slice(0, 10).map((o) => ({
      id: o.id,
      status: o.status,
      type: o.type,
      createdAt: o.createdAt,
    })),
  });
});
