"use server";

import { revalidatePath } from "next/cache";
import {
  createOrder,
  updateOrder,
  getOrder,
  advanceOrderStatus,
  countOpenOrdersForPhone,
  listAppointments,
  markOrderDeleted,
  isMissingColumnError,
} from "@/lib/repositories/orders";
import { listLotsByOrder, deleteLotsForOrder } from "@/lib/repositories/inventory";
import { blocksOrderDelete } from "@/domain/inventory";
import { slotConflict } from "@/domain/booking";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { sendAndLog, userFacingSendError } from "@/lib/messaging";
import { TEMPLATES, stageTemplate, formatPickupDate } from "@/domain/messages";
import { normPhone, itemsTotal, currency, fmtApptTime } from "@/domain/format";
import { validateNewOrder, firstError } from "@/domain/validation";
import {
  isEditable,
  canCancel,
  canAdvanceTo,
  STOP_OUTCOMES,
  stopOutcomeLabel,
  announcesStage,
  isCancelled,
  isWalkIn,
  stopOutcomeAnnounces,
  canDeleteOrder,
  statusLabel,
} from "@/domain/orders";
import { canContactOrder, canContactCustomers, todayKey } from "@/domain/access";
import { setLeadSourceIfEmpty } from "@/lib/repositories/contact-notes";
import { officeAddressLine } from "@/lib/business";
import { attemptImmediateReviewAsk } from "@/lib/reminder-sweep";
import {
  notifyTeamOfNewAppointment,
  notifyTeamOfReschedule,
  notifyTeamOfAppointmentEnded,
} from "@/lib/appointment-notify";

/**
 * Server actions for the employee surface. These are the only writable path
 * into order data — the UI never touches Supabase for writes directly,
 * which keeps validation and messaging in one place.
 *
 * EXPECTED FAILURES ARE RETURNED, NOT THROWN.
 *
 * Next strips the message off anything a Server Action throws in a production
 * build, replacing it with a generic "an error occurred" and a digest, and it
 * drops custom properties entirely. So a thrown "This customer already has an
 * open order" reaches the browser as boilerplate, and `err.fieldErrors` never
 * arrives at all — while working perfectly in dev, which is the worst way for a
 * bug like this to behave.
 *
 * Anything a user can legitimately hit therefore comes back as
 * `{ error, ...context }`; throwing is reserved for genuine faults, where the
 * generic message is the right thing to show anyway.
 *
 * An ESLint rule enforces this — see the `no-restricted-syntax` override in
 * .eslintrc.json, which is what stops the next action from quietly going back
 * to throwing. `fail` lives in lib/ because a "use server" module may only
 * export async functions, so it cannot be shared from here.
 */

/**
 * The double-book refusal both booking actions share: the fail() to return
 * when the proposed appointment lands in a 15-minute slot somebody already
 * holds, or null when the slot is clear.
 *
 * FAIL-OPEN on a read error, like the lead-source write and for the same
 * reason: this guard is protection, not the product, and a database hiccup in
 * it must never stop an order being taken. The slot picker showed the person
 * the day anyway.
 */
async function refuseSlotClash({ pickupDate, pickupTime, excludeId = null }) {
  let clash = null;
  try {
    const dayAppointments = await listAppointments({ onDay: pickupDate });
    clash = slotConflict(dayAppointments, { pickupDate, pickupTime, excludeId });
  } catch (err) {
    console.error("Double-book check failed:", err?.message || err);
    return null;
  }
  if (!clash) return null;
  return fail(
    `${fmtApptTime(pickupTime)} that day already has ${clash.name}'s meetup. ` +
      "Pick a free slot, or book it anyway.",
    { slotTaken: true },
  );
}

/** Create a new order: a booked meetup, or a walk-in that already happened. */
export async function createOrderAction(input) {
  const me = await requireStaff();
  const staff = me.name;

  // A walk-in is over before it is typed: the customer stood at the counter,
  // handed over their devices and left with money. So it is created finished —
  // received and paid in one save — rather than walked through stages that all
  // happened in the same minute. Read off the input once, here, because
  // everything below branches on it.
  const walkIn = isWalkIn(input);

  // THE MONEY GATE, and it is here for the same reason the one in
  // advanceOrderAction is there: this branch does not create work, it records
  // money that has already changed hands. A walk-in is written straight to
  // paid, with an amount and a method the caller supplies, and it lands in
  // cash flow and the float dashboard as a real payout — so it is the one
  // intake that must ask WHO is asking, not just whether they are signed in.
  if (walkIn && !canContactCustomers(me.role)) {
    return fail("Only office staff can record a walk-in.");
  }

  // The form checks these too, for good per-field messages. This is the check
  // that counts: a server action is a public endpoint, and the form's rules
  // are only a courtesy to whoever is using the form.
  const order = input;
  const errors = validateNewOrder(order);
  if (Object.keys(errors).length > 0) {
    // Returned, not thrown: the field map is what lets the form highlight the
    // offending input, and a thrown error arrives in production without it.
    return fail(firstError(errors), { fieldErrors: errors });
  }

  // DUPLICATES ARE REFUSED, NOT JUST FLAGGED. The form warns while someone is
  // typing, but a warning is only advice — and two open orders for one visit
  // means one of them is never satisfied. Creating anyway is legitimate (a
  // customer really does book two trips), so this is a stop with a way through
  // rather than a wall: the form re-submits with confirmDuplicate.
  if (!order.confirmDuplicate) {
    const open = await countOpenOrdersForPhone(order.phone);
    if (open > 0) {
      return fail(
        `This customer already has ${open} open order${open === 1 ? "" : "s"}. ` +
          "Check it isn't the same devices before creating another.",
        { duplicateCount: open },
      );
    }
  }

  // TWO CUSTOMERS, ONE SLOT is refused the same way a duplicate is: a stop
  // with a way through (confirmDoubleBook), because parallel visits are
  // legitimate when two people are covering them. A walk-in already happened
  // and an untimed booking holds no slot, so neither is checked.
  if (!walkIn && order.pickupDate && !order.confirmDoubleBook) {
    const refusal = await refuseSlotClash({
      pickupDate: order.pickupDate,
      pickupTime: order.pickupTime,
    });
    if (refusal) return refusal;
  }

  /**
   * Line items, with any per-line note bounded and attributed.
   *
   * The items array is stored as jsonb straight from the client, so a note
   * typed at intake would otherwise land in the database at whatever length
   * someone pasted, and with no record of who wrote it — while the same note
   * added later through setItemNoteAction is trimmed, capped and signed. Two
   * paths to one field must not disagree about its shape.
   *
   * Spread rather than whitelisted: dropping to a known set of keys here would
   * silently discard anything the form starts sending next, and this is not the
   * change that should decide that.
   */
  const items = (Array.isArray(order.items) ? order.items : []).map((it) => {
    const note = String(it?.note ?? "")
      .trim()
      .slice(0, 300);
    // The stated condition, same bound as a grade on /settings. Validation
    // above already required one on every booked line; this only tidies it.
    const condition = cleanCondition(it?.condition);
    // An empty note is no note — otherwise "+ note" then thinking better of it
    // leaves a blank sticky on the line forever.
    if (!note) return { ...it, condition, note: undefined, noteBy: undefined, noteAt: undefined };
    return { ...it, condition, note, noteBy: staff, noteAt: Date.now() };
  });

  /**
   * The payout, for a walk-in only.
   *
   * Recomputed from the input the same way estValue is, and for the same
   * reason: this is money, and the client sending a number means anything can
   * send any number. Validation above has already refused a blank or negative
   * one, so this is a coercion rather than a second opinion.
   */
  const now = Date.now();
  const paidAmount = walkIn ? Number(order.paidAmount) : undefined;
  const paymentMethod = walkIn && paidAmount > 0 ? order.paymentMethod : undefined;

  /**
   * The trail, in the app's own grammar.
   *
   * Three entries at the same instant, because three things really did happen
   * at once. Worth the repetition: "Marked received" and "Marked paid <amount>"
   * are the exact strings the rest of the app writes for those transitions, and
   * domain/cash.js falls back to reading them when the timestamp columns
   * aren't there. A walk-in logged in its own private wording would be
   * invisible to that fallback — money out with no date on it.
   */
  const activity = walkIn
    ? [
        { action: "Walk-in recorded", by: staff, at: now },
        { action: "Marked received", by: staff, at: now },
        {
          action: `Marked paid ${currency(paidAmount)}${paymentMethod ? ` via ${paymentMethod}` : ""}`,
          by: staff,
          at: now,
        },
      ]
    : [{ action: "Order created", by: staff, at: now }];

  const shipment = {
    type: "office",
    // Created FINISHED. The alternative — awaiting, then two clicks — asks
    // somebody to tell the app three times about one handover, and leaves an
    // order claiming we are waiting on a visit that is already over.
    // Note this deliberately does NOT set checkedInAt: the devices are here
    // and uncounted, so the order still lands in Pending Check-in, where the
    // count either agrees with what we paid or surfaces a correction.
    status: walkIn ? "paid" : "awaiting",
    walkIn,
    paidAmount,
    paymentMethod,
    // Both stamped so cash flow and the float dashboard date this to the minute
    // rather than falling back to created_at.
    paidAt: walkIn ? now : undefined,
    receivedAt: walkIn ? now : undefined,
    name: order.name,
    phone: normPhone(order.phone),
    // Recomputed, never trusted: estValue is money, and the client sending it
    // means anything can set it to anything.
    items,
    estValue: itemsTotal(items),
    // NO DATE ON A WALK-IN, on purpose. pickup_date means "the appointment",
    // and there wasn't one — filling it with today would put a finished visit
    // on the calendar as a stop somebody might prepare for. When it happened
    // is created_at, which is exact.
    pickupDate: walkIn ? null : order.pickupDate,
    pickupTime: walkIn ? null : order.pickupTime,
    // A walk-in's buy already happened, and whoever is typing it did it.
    // Automatic on purpose (never a form field): the login is already known,
    // and a typed name would fragment the per-person P/L it exists to feed.
    boughtBy: walkIn ? staff : undefined,
    activity,
    createdBy: staff,
  };

  const created = await createOrder(shipment);

  // "How did they hear about us?" — a fact about the PERSON, kept on
  // contact_notes rather than the order, and first-order-wins so a repeat
  // order can't overwrite where somebody originally came from. Best-effort
  // (it logs its own failures): an order must never fail because a marketing
  // fact couldn't be written.
  await setLeadSourceIfEmpty(created.phone, order.leadSource);

  // A booked meetup is an appointment; the customer needs to know when and
  // where. Non-fatal, like the stage texts: a failed send must not lose the
  // order that was just created.
  //
  // NOT FOR A WALK-IN. This template says "you're booked in for a visit" —
  // the app talking past somebody who is standing in front of it, about a
  // visit that just ended. It is also the ONLY message a walk-in could ever
  // produce: announcesStage() already keeps quiet on received and paid, so
  // with this skipped the whole lifecycle is silent, which is what it should
  // be for a conversation that happened out loud.
  // A walk-in's whole lifecycle is otherwise silent (see above), which makes
  // this the one text it CAN get: the same immediate review ask a booked
  // meetup receives when it's marked paid (advanceOrderAction) — a walk-in
  // just reaches "paid" here, at creation, instead.
  let textError = null;
  if (!walkIn && created.phone) {
    try {
      await deliverText(
        created,
        TEMPLATES.pickup_scheduled(created, { officeLine: await officeAddressLine() }),
        {
          auto: true,
          staff,
        },
      );
    } catch (err) {
      console.error(`Meetup confirmation failed for ${created.id}:`, err?.message || err);
      textError = err?.message || "The confirmation text could not be sent.";
    }
  } else if (walkIn && created.phone) {
    textError = await tryReviewAsk(created);
  }

  // A real appointment, not a walk-in that already happened: tell the team
  // it's on the calendar. Best-effort and never throws on its own (see
  // notifyTeamOfNewAppointment) - this runs after the order is already saved.
  if (!walkIn) {
    await notifyTeamOfNewAppointment(created, me);
  }

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  // A walk-in lands in two places the moment it is saved: the check-in queue
  // (devices here, uncounted) and the cash screens (money already gone).
  // Without these the counter's own work is missing from the pages someone
  // walks to next.
  if (walkIn) {
    revalidatePath("/employee/inventory/check-in");
    revalidatePath("/employee/pl");
  }
  return { ...created, textError };
}

// The manual "text appointment reminder" action lived here until 2026-08-01.
// Appointment reminders send THEMSELVES now — day before, morning of, and
// ~30 minutes ahead, per domain/appointments.js via /api/appointments — for
// the same reason any manual reminder stopped being a button: a reminder
// that depends on somebody remembering to press it is the failure mode it
// exists to cover.

/**
 * Move a booked appointment to a new date/time.
 *
 * The most ordinary thing a customer asks for: "can you do Saturday instead?"
 * Without this, moving a meetup meant cancelling the order and building a new
 * one — which then tripped the duplicate-order refusal.
 *
 * Only while the job is still ahead of us: once a meetup is marked bought the
 * visit happened, and moving its date would be rewriting history.
 *
 * The customer is TOLD, with wording that leads on the change. A silent
 * reschedule is worse than none — they turn up on the old day.
 */
export async function rescheduleOrderAction(
  id,
  { pickupDate, pickupTime, confirmDoubleBook = false } = {},
) {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canContactCustomers(staff.role)) return fail("You can't reschedule orders.");
  if (order.status !== "awaiting") {
    return fail("This visit already happened - it can't be moved.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ""))) {
    return fail("Pick the new date.", { fieldErrors: { pickupDate: "Pick the new date." } });
  }

  const was = [order.pickupDate, order.pickupTime].filter(Boolean).join(" ");
  const now = [pickupDate, pickupTime].filter(Boolean).join(" ");
  if (was === now) return fail("That's the same appointment it already has.");

  // Same slot rule as intake, excluding the order being moved — an order is
  // allowed to shuffle inside its own slot. The Reschedule form warns and
  // routes the override through its confirm dialog; this is the check that
  // counts, since a server action is a public endpoint.
  if (!confirmDoubleBook) {
    const refusal = await refuseSlotClash({ pickupDate, pickupTime, excludeId: id });
    if (refusal) return refusal;
  }

  const activity = [
    ...(order.activity || []),
    {
      action: `Rescheduled from ${was || "unscheduled"} to ${now}`,
      by: staff.name,
      at: Date.now(),
    },
  ];

  const saved = await updateOrder(id, {
    pickupDate,
    pickupTime: pickupTime || null,
    // A new appointment supersedes the failed attempt: the "Didn't show up"
    // chip comes off, the attention count drops, and the two-day "still want
    // to sell?" follow-up has nothing left to chase. The attempt itself stays
    // in the activity trail above, which is where history lives.
    stopOutcome: null,
    stopOutcomeNote: null,
    stopOutcomeAt: null,
    activity,
  });

  // Same contract as a stage change: the move is already saved, so a failed
  // text is REPORTED rather than thrown, and the caller offers a resend.
  const textError = order.phone
    ? await tryStageText(
        saved ?? { ...order, pickupDate, pickupTime },
        TEMPLATES.pickup_rescheduled,
        staff.name,
      )
    : null;

  // The team asked to know about any change to an appointment, not just a
  // new one. Human-formatted "was", unlike the raw YYYY-MM-DD/HH:MM the
  // activity line above keeps - that one is a record, this one is read on a
  // lock screen.
  const wasHuman = [formatPickupDate(order.pickupDate), fmtApptTime(order.pickupTime)]
    .filter(Boolean)
    .join(" at ");
  await notifyTeamOfReschedule(saved ?? { ...order, pickupDate, pickupTime }, wasHuman, staff);

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  return { textError };
}

/**
 * Correct an order's details while it is still awaiting.
 *
 * The case this exists for is a mistyped name or a changed device list
 * discovered after the order was saved. Restricted to `awaiting` on purpose:
 * once a meetup has been bought or paid, the row is a record of what happened,
 * not a draft. The payout is the one thing correctable later, and it has its
 * own action so the reason gets recorded with it.
 */
export async function updateOrderAction(id, input) {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canContactCustomers(staff.role)) return fail("You can't edit orders.");
  if (!isEditable(order)) {
    return fail("Only an order that is still awaiting can be edited.");
  }

  const merged = { ...order, ...input };
  const errors = validateNewOrder(merged);
  if (Object.keys(errors).length > 0) {
    // Same shape as createOrderAction: the field map is what lets the form mark
    // the offending input, and it is exactly what a thrown error loses.
    return fail(firstError(errors), { fieldErrors: errors });
  }

  const items = Array.isArray(input.items)
    ? input.items.map((it) => ({ ...it, condition: cleanCondition(it?.condition) }))
    : order.items;
  // The estimate is the number a dispute reaches for ("you said $305 on the
  // phone"), so a change to it is recorded with both ends, not just landed.
  const itemsChanged =
    Array.isArray(input.items) && JSON.stringify(order.items || []) !== JSON.stringify(items);
  const activity = [
    ...(order.activity || []),
    {
      action: itemsChanged
        ? `Order edited - items updated, est ${currency(itemsTotal(order.items))} -> ${currency(itemsTotal(items))}`
        : "Order edited",
      by: staff.name,
      at: Date.now(),
    },
  ];

  await updateOrder(id, {
    name: merged.name,
    phone: normPhone(merged.phone),
    items,
    // Recomputed here as it is at intake: the client sending a total is the
    // client deciding what we pay.
    estValue: itemsTotal(items),
    activity,
  });

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  return undefined;
}

/**
 * End an order without money changing hands.
 *
 * Terminal like paid, and meaning the opposite. The practical effect is that it
 * leaves the follow-up sweeps and the attention lists — a customer who called
 * to cancel should stop being chased.
 *
 * The customer is NOT texted. There is no good automatic message here: the
 * reason might be "they cancelled" (they know) or "we can't buy these"
 * (needs a person's words). Staff can text from the same screen.
 */
export async function cancelOrderAction(id, reason) {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canContactCustomers(staff.role)) return fail("You can't cancel orders.");
  if (!canCancel(order)) return fail("A paid order can't be cancelled.");

  const why = String(reason || "").trim();
  if (!why) return fail("Give a reason so this is explainable later.");

  const activity = [
    ...(order.activity || []),
    { action: `Cancelled - ${why}`, by: staff.name, at: Date.now() },
  ];
  await updateOrder(id, {
    status: "cancelled",
    cancelReason: why,
    cancelledAt: new Date().toISOString(),
    activity,
  });

  await notifyTeamOfAppointmentEnded("Appointment cancelled", order, staff);

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  return undefined;
}

/**
 * Strike an order from the books — ADMIN ONLY.
 *
 * "Delete" here means: keep the record, remove its effect. The row stays
 * (name, phone, what was promised, what was paid, every activity line) because
 * somebody will want to read it later; what goes is everything that counted —
 * the order's devices leave inventory, and the order drops out of every money
 * figure. The second half costs no new reader: the status flips to cancelled,
 * the one state every money screen already excludes (see isDeleted in
 * domain/orders.js), and `deleted_at` is what tells the two apart on screen.
 *
 * REFUSED while any of its devices is on an invoice or sold. Those lots are
 * lines on a money document a buyer was billed from; deleting them out from
 * under it would restate that invoice silently. Void it (or undo the eBay
 * sale) first — the lots return to stock, and the delete goes through.
 *
 * ORDER OF WRITES: lots first, then the order. If the lots are gone and the
 * order flip then fails, the order is intact and visibly short of devices,
 * and a retry finishes the job. The other way round would leave a deleted
 * order whose lots still count in P/L — the exact thing this exists to stop.
 *
 * Nothing is texted: there is no message to a customer that says "we deleted
 * you", and if they need to hear something a person should say it.
 */
export async function deleteOrderAction(id, reason) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can delete an order.");

  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canDeleteOrder(order)) return fail("This order was already deleted.");

  const why = String(reason || "").trim();
  if (!why) return fail("Say why - it's the only explanation that will exist later.");

  // The inventory half comes first, and it can refuse.
  const lots = await listLotsByOrder(id);
  const blocking = lots.filter(blocksOrderDelete);
  if (blocking.length) {
    const n = blocking.length;
    return fail(
      `${n} device${n === 1 ? " is" : "s are"} on an invoice or sold. Void the invoice ` +
        "(or undo the eBay sale) so they return to stock, then delete the order.",
    );
  }

  let removed = [];
  try {
    removed = await deleteLotsForOrder(id);
  } catch (err) {
    console.error(`Delete: removing lots for ${id} failed:`, err?.message || err);
    return fail("Couldn't remove the order's devices from inventory - nothing was changed.");
  }

  // A lot invoiced between the check above and the delete survives its guard.
  // Stop here rather than delete an order whose devices still count.
  const left = await listLotsByOrder(id);
  if (left.length) {
    return fail(
      `${left.length} device${left.length === 1 ? " was" : "s were"} just put on an invoice, ` +
        `so the order was NOT deleted (${removed.length} in-stock device${removed.length === 1 ? "" : "s"} ` +
        "already left inventory). Void that invoice, then delete again.",
    );
  }

  // The trail keeps what the row loses: which devices were removed, and what
  // state the order was in when it was struck.
  const was = statusLabel(order.status, order).toLowerCase();
  const paid =
    order.status === "paid" && order.paidAmount != null
      ? ` (${currency(order.paidAmount)}${order.paymentMethod ? ` via ${order.paymentMethod}` : ""})`
      : "";
  const devices = removed.length
    ? ` Removed ${removed.length} device${removed.length === 1 ? "" : "s"} from inventory: ` +
      removed.map((l) => [l.item, l.imei || l.serial].filter(Boolean).join(" ")).join("; ") +
      "."
    : "";
  const activity = [
    ...(order.activity || []),
    {
      action: `Deleted while ${was}${paid} - ${why}.${devices}`,
      by: staff.name,
      at: Date.now(),
    },
  ];

  let saved;
  try {
    saved = await markOrderDeleted(id, { deletedBy: staff.name, deleteReason: why, activity });
  } catch (err) {
    if (isMissingColumnError(err)) {
      return fail(
        "The database needs supabase/migrations/0005_order_delete.sql before orders can be " +
          "deleted - run it in the Supabase SQL editor, then try again.",
      );
    }
    throw err;
  }
  if (!saved) return fail("Someone else already deleted this order.");

  await notifyTeamOfAppointmentEnded("Appointment deleted", order, staff);

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  revalidatePath("/employee/inventory");
  revalidatePath("/employee/customers");
  revalidatePath("/employee/pl");
  return { removed: removed.length };
}

/** A stated condition as stored on a line: trimmed, bounded, blank -> absent. */
function cleanCondition(value) {
  const clean = String(value ?? "")
    .trim()
    .slice(0, 40);
  return clean || undefined;
}

/**
 * Record that a booked meetup produced no devices.
 *
 * THE ORDER STAYS AWAITING. A visit nobody showed for is a visit to rebook,
 * and this is the whole point of the action: without it the only button was
 * "Mark bought", so a failed meetup either went unrecorded or was logged as a
 * success — which also leaves the order claiming we bought devices we don't
 * have.
 *
 * ONE OF THE TWO OUTCOMES TEXTS THE CUSTOMER (stopOutcomeAnnounces): a missed
 * meetup invites a rebook while it is still fresh. A customer who cancelled
 * told us themselves, so that one stays silent. Same contract as every stage
 * text: the record stands even when the send fails, and the failure comes
 * back as textError rather than an error.
 */
export async function reportStopOutcomeAction(id, outcome, note = "") {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canContactOrder(staff.role, order, staff.id, todayKey())) {
    return fail("You can't report on this order.");
  }
  if (!STOP_OUTCOMES.some((o) => o.key === outcome)) return fail("Unknown outcome.");

  const label = stopOutcomeLabel(outcome);
  const clean = String(note || "").trim();
  const activity = [
    ...(order.activity || []),
    {
      action: `Visit failed - ${label}${clean ? `: ${clean}` : ""}`,
      by: staff.name,
      at: Date.now(),
    },
  ];

  const patch = {
    stopOutcome: outcome,
    stopOutcomeNote: clean || null,
    stopOutcomeAt: new Date().toISOString(),
    activity,
  };
  await updateOrder(id, patch);

  const textError =
    stopOutcomeAnnounces(outcome) && order.phone
      ? await tryStageText({ ...order, ...patch }, TEMPLATES.visit_missed, staff.name)
      : null;

  await notifyTeamOfAppointmentEnded(label, order, staff);

  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  return textError ? { textError } : undefined;
}

/**
 * Correct a payout that was already recorded.
 *
 * The only field editable after an order is finished, because it is the only
 * one where a typo has consequences that outlive the order: it feeds every
 * total on the dashboard. A reason is required — a payout that silently
 * changed is worse than one that was wrong.
 *
 * Does NOT re-text the customer. They were told an amount; if it was wrong,
 * that is a conversation, not a template.
 */
export async function correctPayoutAction(id, amount, reason) {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");
  if (!canContactCustomers(staff.role)) return fail("You can't correct payouts.");
  if (order.status !== "paid") return fail("This order hasn't been paid yet.");

  const next = Number(amount);
  if (!(next >= 0)) return fail("Enter a valid amount.");
  const why = String(reason || "").trim();
  if (!why) return fail("Say why the amount changed.");

  const activity = [
    ...(order.activity || []),
    {
      action: `Payout corrected ${currency(order.paidAmount || 0)} to ${currency(next)} - ${why}`,
      by: staff.name,
      at: Date.now(),
    },
  ];
  await updateOrder(id, { paidAmount: next, payoutReason: why, activity });

  revalidatePath("/employee");
  revalidatePath(`/employee/orders/${id}`);
}

/**
 * Advance an order to a new status, append an activity entry, and (when the
 * stage announces itself) send the matching templated text.
 */
export async function advanceOrderAction(id, nextStatus, patch = {}) {
  const me = await requireStaff();
  const staff = me.name;
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");

  // THE MONEY GATE. This action records payouts, and for a long time it
  // checked only that you were signed in. The bound is the office roles, the
  // same set that runs the inbox — canContactOrder keeps the same signature
  // so the rule reads identically here and in the composer.
  if (!canContactCustomers(me.role) && !canContactOrder(me.role, order, me.id, todayKey())) {
    return fail("You can't update this order.");
  }

  // ALREADY DONE is the common case and the cheap one to catch: two people had
  // the order open, one pressed first, and the second is about to redo work
  // that already happened. A conditional write alone misses this — by the time
  // the second request re-reads, the row legitimately IS in the target status,
  // so the write matches and succeeds.
  if (order.status === nextStatus) {
    return fail(`Someone else already marked this ${nextStatus}.`);
  }

  // LEGAL, not just consistent. The compare-and-swap below proves nobody else
  // moved the row; it cannot prove the move is allowed, because it is keyed on
  // the status we just read. So a stale tab whose buttons rendered while the
  // order was awaiting can post paid->received and pay a finished order a second
  // time. The ladder only goes forward, one rung at a time.
  if (!canAdvanceTo(order, nextStatus)) {
    return fail(
      isCancelled(order)
        ? "This order was cancelled - reopen it from the order page, not here."
        : `This order is ${order.status} and can't be marked ${nextStatus}.`,
    );
  }

  // THE PATCH IS WHITELISTED, not spread. A server action is a public POST, and
  // spreading the caller's object let any field in ORDER_FIELD_TO_COLUMN ride
  // along - a crafted call could stamp checkedInAt (dropping the order from the
  // check-in queue and its paid-vs-counted audit) or write a negative payout.
  // Only a payout carries fields, and each is coerced: the amount is money, so
  // the client sending it is the client deciding what we pay.
  const changes = { status: nextStatus };
  if (nextStatus === "paid") {
    const amount = Number(patch.paidAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      return fail("Enter a payout of zero or more.", {
        fieldErrors: { paidAmount: "Enter a payout of zero or more." },
      });
    }
    changes.paidAmount = amount;
    changes.paymentMethod = patch.paymentMethod || null;
    changes.payoutReason = patch.payoutReason ? String(patch.payoutReason).trim() : null;
  }

  const now = Date.now();
  // The amount belongs IN the trail, not only in the column. A dispute weeks
  // later ("you paid me for two phones") is answered by reading the log, and a
  // later correction rewrites paidAmount — so without this the original figure
  // was recoverable only by walking the correction chain backwards.
  const paidNote =
    nextStatus === "paid"
      ? ` ${currency(changes.paidAmount)}${changes.paymentMethod ? ` via ${changes.paymentMethod}` : ""}`
      : "";
  changes.activity = [
    ...(order.activity || []),
    { action: `Marked ${nextStatus}${paidNote}`, by: staff, at: now },
  ];

  // The day the money moved, and the day the devices landed. Cash flow needs
  // both, and neither was recorded anywhere but the activity log — which is an
  // audit trail, not a column anything can filter or index on. domain/cash.js
  // still reads the log as a fallback for orders written before these columns,
  // so nothing here can block a payout.
  if (nextStatus === "paid" && !order.paidAt) changes.paidAt = now;
  if (nextStatus === "received" && !order.receivedAt) changes.receivedAt = now;
  // Who did the buy — the account that pressed "Mark bought", captured once
  // and never overwritten (a re-advance after a step-back keeps the original
  // buyer). Check-in copies it onto every lot for the per-person P/L.
  if (nextStatus === "received" && !order.boughtBy) changes.boughtBy = staff;

  // And the narrow window the check above cannot cover: two requests that both
  // read the old status before either wrote. The filter settles it in the
  // database, which is the only place it can be settled when the two are
  // handled by different server instances.
  const saved = await advanceOrderStatus(id, order.status, changes);
  if (!saved) {
    const current = await getOrder(id);
    return fail(
      current?.status === nextStatus
        ? `Someone else already marked this ${nextStatus}.`
        : "This order changed while you were looking at it. Reload and try again.",
    );
  }
  const updated = saved;

  // A failed text must NOT fail the whole action: the status change is already
  // persisted, so throwing would show an error for work that succeeded and a
  // retry would advance the stage twice. The failure is returned instead, and
  // the UI offers a resend.
  //
  // announcesStage stays the branch point even though it currently refuses
  // every rung — bought and paid happen face to face, a person just said it
  // out loud. If a stage ever earns a text again, this is where it plugs in —
  // which is exactly what the review ask is: not a stage announcement, but
  // paid is the one rung with nothing else to send, so it's free to use.
  const textError = announcesStage(updated, nextStatus)
    ? await tryStageText(updated, TEMPLATES[nextStatus], staff)
    : nextStatus === "paid"
      ? await tryReviewAsk(updated)
      : null;

  revalidatePath("/employee");
  revalidatePath("/employee/calendar");
  revalidatePath(`/employee/orders/${id}`);
  return { ...updated, textError };
}

/**
 * Put a note on ONE line of an order — "cracked screen", "customer says the
 * battery was replaced", "brings the charger too".
 *
 * NARROW ON PURPOSE. `items` is the agreed line: est_value derives from it and
 * check-in reconciles the counted devices against it, which is how a paid-vs-
 * counted gap gets caught. Nothing has written to items since intake, and this
 * is not the feature that should change that — so it rewrites the array with
 * only the note fields touched and every name, quantity and price copied
 * across untouched. A notes box must not become a back door to editing what was
 * agreed.
 *
 * Attribution travels WITH the note rather than going to the activity trail: a
 * note is read on the line it belongs to, and "who said this and when" is the
 * first question anyone asks about it. Writing an activity entry per keystroke
 * of a note would also drown the trail that records what actually happened.
 *
 * @param {string} id order id
 * @param {number} index which line
 * @param {string} note free text; empty clears it
 */
export async function setItemNoteAction(id, index, note) {
  const staff = await requireStaff();
  const order = await getOrder(id);
  if (!order) return fail("Order not found.");

  // Same permission as editing the order.
  if (!canContactCustomers(staff.role)) return fail("You can't edit this order.");

  const items = Array.isArray(order.items) ? order.items : [];
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= items.length)
    return fail("That line no longer exists.");

  // Bounded so a paste of a whole email cannot become the line item.
  const clean = String(note ?? "")
    .trim()
    .slice(0, 300);

  const next = items.map((item, at) =>
    at === i
      ? {
          ...item,
          note: clean || undefined,
          noteBy: clean ? staff.name : undefined,
          noteAt: clean ? Date.now() : undefined,
        }
      : item,
  );

  await updateOrder(id, { items: next });
  revalidatePath(`/employee/orders/${id}`);
  revalidatePath(`/employee/inventory/check-in/${id}`);
  return { ok: true };
}

/**
 * Send a templated text, returning the failure rather than throwing it.
 * Shared by every path where the database write has already committed.
 */
async function tryStageText(order, template, staff) {
  if (!template || !order.phone) return null;
  try {
    const officeLine = await officeAddressLine();
    await deliverText(order, template(order, { officeLine }), { auto: true, staff });
    return null;
  } catch (err) {
    console.error(`Text failed for order ${order.id}:`, err?.message || err);
    return err?.message || "The text could not be sent.";
  }
}

/**
 * The Google review ask, fired the instant an order is marked paid — see
 * attemptImmediateReviewAsk in lib/reminder-sweep.js for the eligibility
 * rules (first payout only, link configured, not already asked). Same
 * non-throwing contract as tryStageText: the status change already
 * committed, so a failed text is reported, not thrown.
 */
async function tryReviewAsk(order) {
  if (!order.phone) return null;
  try {
    return await attemptImmediateReviewAsk(order);
  } catch (err) {
    console.error(`Review ask failed for order ${order.id}:`, err?.message || err);
    return err?.message || "The review request text could not be sent.";
  }
}

/**
 * Re-send the text for an order's current stage.
 *
 * The counterpart to the actions swallowing send failures: the change was
 * saved, the customer wasn't told, and this is how staff put that right
 * without touching the status again.
 */
export async function resendStageTextAction(id) {
  const staff = (await requireStaff()).name;
  const shipment = await getOrder(id);
  if (!shipment) return fail("Order not found.");
  if (!shipment.phone) return fail("This customer has no phone number on file.");

  const template = stageTemplate(shipment);
  if (!template) return fail("There's no message for this stage.");
  // Same rule as advanceOrderAction, or "resend" would send a message that was
  // never sent in the first place and was never meant to be.
  if (!announcesStage(shipment, shipment.status)) {
    return fail("This stage doesn't text the customer - they were there in person.");
  }

  try {
    // officeAddressLine too: the appointment templates put the address in the
    // message, and a meetup that resends without it tells the customer to come
    // to nowhere.
    await deliverText(shipment, template(shipment, { officeLine: await officeAddressLine() }), {
      auto: true,
      staff,
    });
  } catch (err) {
    const message = userFacingSendError(err);
    if (!message) throw err;
    return fail(message);
  }

  revalidatePath(`/employee/orders/${id}`);
}

/**
 * Send a free-form text to an order's customer and log it.
 *
 * Checked here, not only in the UI. Hiding the composer stops the button being
 * pressed; it does not stop a server action being called. This is the check
 * that decides.
 */
export async function messageCustomerAction(id, text) {
  const staff = await requireStaff();
  const shipment = await getOrder(id);
  if (!shipment?.phone) return fail("This customer has no phone number on file.");
  if (!canContactOrder(staff.role, shipment, staff.id, todayKey())) {
    return fail("You can't message this customer.");
  }
  try {
    await deliverText(shipment, text, { auto: false, staff: staff.name, role: staff.role });
  } catch (err) {
    const message = userFacingSendError(err);
    if (!message) throw err;
    return fail(message);
  }
  revalidatePath(`/employee/orders/${id}`);
}

/** Internal: send via the shared path (opt-out check, SID capture, logging). */
async function deliverText(shipment, text, { auto, staff, role = null }) {
  await sendAndLog({
    phone: shipment.phone,
    orderId: shipment.id,
    body: text,
    auto,
    sentBy: staff,
    sentByRole: role,
  });
}
