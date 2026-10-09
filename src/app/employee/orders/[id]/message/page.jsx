import { notFound } from "next/navigation";
import { SimpleThread } from "@/components/employee/SimpleThread";
import { getOrder } from "@/lib/repositories/orders";
import { listMessagesByPhone } from "@/lib/repositories/messages";
import { getContactNotes } from "@/lib/repositories/contact-notes";
import { getCurrentStaff } from "@/lib/auth";
import { canContactOrder, todayKey } from "@/domain/access";
import { isMessagingEnabled } from "@/domain/mode";

/**
 * Talk to one customer, and nothing else.
 *
 * Deliberately a child of the ORDER rather than a /messages/[phone] route: the
 * permission that decides whether someone may text this person is already
 * about the order, so hanging the page off the order reuses it exactly. A
 * phone-keyed route would need a second rule that means the same thing, and
 * two rules that mean the same thing eventually stop agreeing.
 *
 * Falls back to notFound rather than an error: to someone with no business
 * here, a page they cannot open should not confirm the order exists.
 */
export default async function OrderMessagePage({ params }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const staff = await getCurrentStaff();
  if (!canContactOrder(staff.role, order, staff.id, todayKey())) notFound();

  // null means the READ failed, not "no notes row" — see the contact prop.
  const [messages, notes] = await Promise.all([
    listMessagesByPhone(order.phone).catch(() => []),
    getContactNotes(order.phone).catch(() => null),
  ]);

  return (
    <SimpleThread
      order={order}
      messages={messages}
      contact={{
        smsOptedOut: Boolean(notes?.smsOptedOutAt),
        remindersCancelledAt: order.remindersCancelledAt,
        statusUnknown: notes === null,
        messagingOff: !isMessagingEnabled(),
      }}
      // Back to where they came from: a meetup lives on the calendar.
      backHref="/calendar"
    />
  );
}
