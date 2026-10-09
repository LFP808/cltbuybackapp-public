import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/employee/OrderDetail";
import { getOrder, listAppointments } from "@/lib/repositories/orders";
import { getBookingSchedule, getPaymentMethods, getGrades } from "@/lib/repositories/settings";
import { listLotsByOrder } from "@/lib/repositories/inventory";
import { listCatalogItems } from "@/lib/repositories/catalog";
import { lotCogTotal } from "@/domain/inventory";
import { listMessagesByPhone } from "@/lib/repositories/messages";
import { listCallsByPhone } from "@/lib/repositories/calls";
import { getContactNotes } from "@/lib/repositories/contact-notes";
import { getCurrentStaff } from "@/lib/auth";
import { canContactCustomers, canContactOrder, todayKey } from "@/domain/access";
import { isSmsTestMode } from "@/lib/twilio/client";
import { officeAddressLine } from "@/lib/business";
import { isMessagingEnabled } from "@/domain/mode";

export default async function OrderPage({ params, searchParams }) {
  const { id } = await params;
  const shipment = await getOrder(id);
  if (!shipment) notFound();

  // Set by the new-order form when the meetup confirmation failed to send. The
  // order was created and the browser navigated away, so this page is the only
  // place left to say the customer was never told.
  const { text } = (await searchParams) || {};

  const staff = await getCurrentStaff();

  // Talking to the customer and changing the order are separate permissions;
  // both use the same predicates the actions use, so the screen and the
  // server cannot disagree.
  const mayContact = canContactOrder(staff.role, shipment, staff.id, todayKey());
  const mayEdit = canContactCustomers(staff.role);

  // The appointment book for the Reschedule slot picker — fetched only when
  // the Reschedule card can render (same gate OrderDetail uses), and best
  // effort: a failed read shows an empty day, and the action still runs the
  // real double-book check.
  const mayReschedule = mayEdit && shipment.status === "awaiting";
  const appointments = mayReschedule ? await listAppointments().catch(() => []) : [];
  const bookingSchedule = mayReschedule ? await getBookingSchedule() : undefined;

  // The admin-set payout methods (app_settings). Read unconditionally — the
  // payout select renders on "received", but the read degrades to the domain
  // constant on its own and gating it on stage would only save one keyed row.
  const paymentMethods = await getPaymentMethods();

  // The meetup address (/settings, env fallback), for the send previews:
  // they show the exact message the action will send, and this input only
  // exists on the server.
  const officeLine = await officeAddressLine();

  // The edit dialog's items editor picks from the same DB-backed catalog as
  // the new-order form. Only fetched when the dialog can render, and the
  // empty fallback lets the editor fall back to the static seed exactly as
  // the intake form does.
  const editable = mayEdit && shipment.status === "awaiting";
  const catalog = editable ? await listCatalogItems().catch(() => []) : [];
  // The condition ladder for the same dialog's per-line picker; getGrades
  // degrades to DEFAULT_GRADES on its own.
  const grades = editable ? await getGrades() : undefined;

  // NOT FETCHED WHEN NOT ALLOWED. These are the customer's words, and props to
  // a Client Component end up in the page payload whether or not they render.
  // null means the READ failed, which is not the same as "no notes row" — see
  // the contact prop below.
  const [messages, calls, notes] = mayContact
    ? await Promise.all([
        listMessagesByPhone(shipment.phone).catch(() => []),
        listCallsByPhone(shipment.phone).catch(() => []),
        getContactNotes(shipment.phone).catch(() => null),
      ])
    : [[], [], null];

  // What check-in actually counted. Only fetched once a check-in exists —
  // it flags a paid-vs-counted gap and prefills a correction.
  //
  // A FAILED read is kept distinct from "no check-in yet": both used to leave
  // checkInTotal null, and null is what tells the payout form to fall back to
  // the PROMISED total — so the one day the lots read hiccupped, the form
  // quietly prefilled what the customer claimed instead of what was counted,
  // with the "differs" warning gone too. Same rule as `statusUnknown` above: a
  // read that failed must never impersonate a clean answer.
  let checkInTotal = null;
  let checkInTotalUnknown = false;
  // How many devices there are to print labels for — the same read.
  let labelCount = 0;
  if (shipment.checkedInAt) {
    const lots = await listLotsByOrder(shipment.id).catch(() => null);
    if (lots) {
      checkInTotal = Math.round(lots.reduce((sum, lot) => sum + lotCogTotal(lot), 0) * 100) / 100;
      labelCount = lots.length;
    } else {
      checkInTotalUnknown = true;
    }
  }

  return (
    <OrderDetail
      shipment={shipment}
      checkInTotal={checkInTotal}
      checkInTotalUnknown={checkInTotalUnknown}
      appointments={appointments}
      bookingSchedule={bookingSchedule}
      paymentMethods={paymentMethods}
      canMessage={mayContact}
      canEdit={mayEdit}
      // Deleting is the admin's alone — the one order action not shared with
      // the VA, checked again inside deleteOrderAction.
      canDelete={staff.role === "admin"}
      labelCount={labelCount}
      catalog={catalog}
      grades={grades}
      messages={messages}
      calls={calls}
      smsTestMode={isSmsTestMode()}
      officeLine={officeLine}
      textFailed={text === "failed"}
      // A carrier block has to reach every composer, not just the inbox.
      // `statusUnknown` keeps a failed read distinct from a clean one: coercing
      // it to "not opted out" made the composer assert something it hadn't
      // checked. Only meaningful when we were allowed to look in the first
      // place — otherwise there is no composer to qualify.
      contact={{
        smsOptedOut: Boolean(notes?.smsOptedOutAt),
        remindersCancelledAt: shipment.remindersCancelledAt,
        statusUnknown: mayContact && notes === null,
        // Read on the server and handed down: the mode is a policy the server
        // enforces, and a copy in the bundle would only be a second place for
        // it to be wrong.
        messagingOff: !isMessagingEnabled(),
        // How this person likes their payout (contact_notes) — the payout
        // form shows where to send it.
        preferredPaymentMethod: notes?.preferredPaymentMethod ?? null,
        paymentHandle: notes?.paymentHandle ?? null,
      }}
    />
  );
}
