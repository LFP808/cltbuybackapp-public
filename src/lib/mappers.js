/**
 * Translate between snake_case database rows and the camelCase domain objects
 * used everywhere in the app. Keeping this in one place means feature code
 * never sees raw DB shapes.
 */

/** @returns {import('@/domain/types').Order} */
export function rowToOrder(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    name: row.name,
    phone: row.phone,
    items: row.items ?? [],
    estValue: row.est_value != null ? Number(row.est_value) : undefined,
    remindersCancelledAt: row.reminders_cancelled_at
      ? new Date(row.reminders_cancelled_at).getTime()
      : undefined,
    pickupDate: row.pickup_date ?? undefined,
    pickupTime: row.pickup_time ?? undefined,
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : undefined,
    paymentMethod: row.payment_method ?? undefined,
    // The cash-flow facts. All optional: domain/cash.js falls back to the
    // activity log when they are absent, so a missing column gives a less
    // exact answer rather than none.
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : undefined,
    receivedAt: row.received_at ? new Date(row.received_at).getTime() : undefined,
    // Whether anybody was expecting this customer. Not derivable after the
    // fact — a booked meetup and a walk-in both end up as a paid office order.
    walkIn: row.walk_in === true,
    payoutReason: row.payout_reason ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).getTime() : undefined,
    // A meetup that produced nothing. The order stays awaiting.
    stopOutcome: row.stop_outcome ?? undefined,
    stopOutcomeNote: row.stop_outcome_note ?? undefined,
    stopOutcomeAt: row.stop_outcome_at ? new Date(row.stop_outcome_at).getTime() : undefined,
    // When the physical devices were counted into inventory. A fact, not a
    // status — the check-in queue derives from its absence.
    checkedInAt: row.checked_in_at ? new Date(row.checked_in_at).getTime() : undefined,
    // Admin deletion. The status column says cancelled; this says WHICH kind.
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : undefined,
    deletedBy: row.deleted_by ?? undefined,
    deleteReason: row.delete_reason ?? undefined,
    activity: row.activity ?? [],
    messages: (row.messages ?? []).map(rowToMessage),
    boughtBy: row.bought_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/** Domain order -> DB columns (only the writable ones). */
export function orderToRow(s) {
  return {
    type: s.type,
    status: s.status,
    name: s.name,
    phone: s.phone,
    items: s.items ?? [],
    est_value: s.estValue ?? null,
    reminders_cancelled_at: s.remindersCancelledAt
      ? new Date(s.remindersCancelledAt).toISOString()
      : null,
    pickup_date: s.pickupDate || null,
    pickup_time: s.pickupTime ?? null,
    paid_amount: s.paidAmount ?? null,
    payment_method: s.paymentMethod ?? null,
    // Set at INSERT for a walk-in, which is created already paid — every
    // other order reaches these through advanceOrderStatus.
    paid_at: s.paidAt ? new Date(s.paidAt).toISOString() : null,
    received_at: s.receivedAt ? new Date(s.receivedAt).toISOString() : null,
    walk_in: s.walkIn === true,
    activity: s.activity ?? [],
    bought_by: s.boughtBy ?? null,
    created_by: s.createdBy ?? null,
  };
}

/**
 * Domain field name -> DB column name, for building partial updates without
 * clobbering columns the caller didn't mention.
 */
export const ORDER_FIELD_TO_COLUMN = {
  type: "type",
  status: "status",
  name: "name",
  phone: "phone",
  items: "items",
  estValue: "est_value",
  remindersCancelledAt: "reminders_cancelled_at",
  pickupDate: "pickup_date",
  pickupTime: "pickup_time",
  paidAmount: "paid_amount",
  paymentMethod: "payment_method",
  paidAt: "paid_at",
  receivedAt: "received_at",
  walkIn: "walk_in",
  payoutReason: "payout_reason",
  cancelReason: "cancel_reason",
  cancelledAt: "cancelled_at",
  stopOutcome: "stop_outcome",
  stopOutcomeNote: "stop_outcome_note",
  stopOutcomeAt: "stop_outcome_at",
  checkedInAt: "checked_in_at",
  deletedAt: "deleted_at",
  deletedBy: "deleted_by",
  deleteReason: "delete_reason",
  activity: "activity",
  boughtBy: "bought_by",
};

/**
 * Timestamptz columns, which the domain carries as epoch milliseconds.
 * Postgres will not take a bare number, and a silently rejected write is
 * worse than a loud one — so the conversion happens here, at the one
 * boundary that exists to do it, rather than at each call site remembering
 * to.
 */
const TIMESTAMP_COLUMNS = new Set([
  "reminders_cancelled_at",
  "cancelled_at",
  "stop_outcome_at",
  "checked_in_at",
  "deleted_at",
  "paid_at",
  "received_at",
]);

/** Build a DB update object from a partial domain patch (only mapped keys). */
export function orderPatchToRow(patch) {
  const row = {};
  for (const [field, column] of Object.entries(ORDER_FIELD_TO_COLUMN)) {
    if (field in patch) {
      const value = patch[field];
      if (column === "pickup_date") {
        // Empty strings for date columns must become null.
        row[column] = value || null;
      } else if (TIMESTAMP_COLUMNS.has(column) && typeof value === "number") {
        row[column] = new Date(value).toISOString();
      } else {
        row[column] = value ?? null;
      }
    }
  }
  return row;
}

/** @returns {import('@/domain/types').Message} */
export function rowToMessage(row) {
  return {
    text: row.body,
    at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    direction: row.direction ?? "outbound",
    auto: row.auto,
    testMode: row.test_mode,
    by: row.sent_by ?? undefined,
    // What they were when they sent it, not what they are now.
    byRole: row.sent_by_role ?? null,
    mediaUrl: row.media_url ?? null,
    readAt: row.read_at ? new Date(row.read_at).getTime() : null,
    // Twilio's verdict on an outbound message, updated by the status webhook.
    // null = test mode, inbound, or sent before delivery tracking existed.
    deliveryStatus: row.delivery_status ?? null,
    deliveryError: row.delivery_error ?? null,
  };
}

/**
 * A row from `inventory_lots` — ONE DEVICE — optionally with its joined
 * order and invoice.
 *
 * `cog` and `rate` are PER-UNIT dollars; `soldTotal` / `shipTotal` are
 * totals written once at settle. P/L is never a column — domain/inventory.js
 * derives it, so it can't drift from its inputs. `details` is the raw
 * Sickw-pulled fact bag; the promoted columns (imei, serial, carrier) are
 * the ones the grid, the exports and the dedupe query need.
 */
export function rowToLot(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    item: row.item,
    category: row.category ?? undefined,
    quantity: row.quantity ?? 0,
    imei: row.imei ?? undefined,
    serial: row.serial ?? undefined,
    carrier: row.carrier ?? undefined,
    grade: row.grade ?? undefined,
    details: row.details ?? {},
    cog: row.cog != null ? Number(row.cog) : 0,
    status: row.status,
    invoiceId: row.invoice_id ?? undefined,
    rate: row.rate != null ? Number(row.rate) : undefined,
    soldTotal: row.sold_total != null ? Number(row.sold_total) : undefined,
    shipTotal: row.ship_total != null ? Number(row.ship_total) : undefined,
    feeTotal: row.fee_total != null ? Number(row.fee_total) : undefined,
    soldChannel: row.sold_channel ?? undefined,
    soldAt: row.sold_at ? new Date(row.sold_at).getTime() : undefined,
    notOnOrder: Boolean(row.not_on_order),
    disposedAt: row.disposed_at ? new Date(row.disposed_at).getTime() : undefined,
    disposeNote: row.dispose_note ?? undefined,
    edits: row.edits ?? [],
    boughtBy: row.bought_by ?? undefined,
    checkedInBy: row.checked_in_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    // Present only when the query embedded them; the grid needs the order's
    // source / payment method and the invoice's number+buyer.
    order: row.orders
      ? {
          type: row.orders.type,
          walkIn: row.orders.walk_in === true,
          name: row.orders.name,
          phone: row.orders.phone,
          paymentMethod: row.orders.payment_method ?? undefined,
        }
      : undefined,
    invoice: row.invoices
      ? {
          number: row.invoices.number,
          status: row.invoices.status,
          buyerName: row.invoices.buyers?.name ?? undefined,
        }
      : undefined,
  };
}

/** Domain lot -> DB columns (only the writable ones). */
export function lotToRow(lot) {
  return {
    order_id: lot.orderId,
    item: lot.item,
    category: lot.category ?? null,
    quantity: lot.quantity,
    imei: lot.imei || null,
    serial: lot.serial || null,
    carrier: lot.carrier || null,
    grade: lot.grade || null,
    details: lot.details ?? {},
    cog: lot.cog ?? 0,
    not_on_order: Boolean(lot.notOnOrder),
    bought_by: lot.boughtBy ?? null,
    checked_in_by: lot.checkedInBy ?? null,
  };
}

export function rowToBuyer(row) {
  return {
    id: row.id,
    name: row.name,
    street: row.street ?? undefined,
    street2: row.street2 ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    zip: row.zip ?? undefined,
    terms: row.terms ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/** A row from `invoices`, optionally with its buyer and lots embedded. */
export function rowToInvoice(row) {
  return {
    id: row.id,
    number: row.number,
    buyerId: row.buyer_id,
    status: row.status,
    projected: row.projected != null ? Number(row.projected) : 0,
    shipping: row.shipping != null ? Number(row.shipping) : 0,
    paid: row.paid != null ? Number(row.paid) : undefined,
    paidMethod: row.paid_method ?? undefined,
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : undefined,
    note: row.note ?? undefined,
    voidedAt: row.voided_at ? new Date(row.voided_at).getTime() : undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    buyer: row.buyers ? rowToBuyer(row.buyers) : undefined,
    lots: row.inventory_lots ? row.inventory_lots.map(rowToLot) : undefined,
  };
}

export function rowToCatalogItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    sort: row.sort ?? 0,
    active: Boolean(row.active),
  };
}

/** A row from `expenses`. `spentOn` stays a YYYY-MM-DD key — it is a day, not an instant. */
export function rowToExpense(row) {
  return {
    id: row.id,
    spentOn: row.spent_on,
    category: row.category,
    vendor: row.vendor ?? undefined,
    note: row.note ?? undefined,
    amount: row.amount != null ? Number(row.amount) : 0,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/** A row from `device_inquiries` — a lead from the marketing site's quote wizard. */
export function rowToDeviceInquiry(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    smsConsent: Boolean(row.sms_consent),
    sourcePage: row.source_page ?? undefined,
    adParams: row.ad_params ?? undefined,
    brand: row.brand ?? undefined,
    model: row.model ?? undefined,
    carrier: row.carrier ?? undefined,
    condition: row.condition ?? undefined,
    issues: row.issues ?? undefined,
    sellMethod: row.sell_method ?? undefined,
    itemCount: row.item_count != null ? Number(row.item_count) : 1,
    deviceSummary: row.device_summary ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

/**
 * A row from `balance_snapshots` — a counted balance the running total rolls
 * forward from. `asOf` stays a YYYY-MM-DD key for the same reason expenses
 * do: it is read off a statement and a counted drawer, which say a day, not
 * an instant.
 */
export function rowToBalanceSnapshot(row) {
  return {
    id: row.id,
    asOf: row.as_of,
    bank: row.bank != null ? Number(row.bank) : 0,
    cash: row.cash != null ? Number(row.cash) : 0,
    note: row.note ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/** A row from `calls` in the shape the UI reads. */
export function rowToCall(row) {
  return {
    id: row.id,
    callSid: row.call_sid,
    direction: row.direction ?? "inbound",
    fromNumber: row.from_number ?? null,
    toNumber: row.to_number ?? null,
    phone: row.phone ?? null,
    status: row.status ?? "queued",
    answeredBy: row.answered_by ?? null,
    answeredName: row.answered_name ?? null,
    toVoicemail: Boolean(row.to_voicemail),
    startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
    endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
    durationSecs: row.duration_secs ?? null,
    recordingUrl: row.recording_url ?? null,
    transcript: row.transcript ?? null,
    transcriptStatus: row.transcript_status ?? null,
    // A voicemail is a message nobody has heard yet — kept apart from
    // recordingUrl, which is a conversation that already happened.
    voicemailUrl: row.voicemail_url ?? null,
    voicemailSecs: row.voicemail_secs ?? null,
    handledAt: row.handled_at ? new Date(row.handled_at).getTime() : null,
    handledBy: row.handled_by ?? null,
    missedTextedAt: row.missed_texted_at ? new Date(row.missed_texted_at).getTime() : null,
    // The auto-answer picked up this call (menuAt) and what became of it
    // (menuChoice: "told_to_text" for the busy message, else a
    // domain/phone-menu.js menu key - null while still in the menu, or
    // forever if they hung up there).
    menuAt: row.menu_at ? new Date(row.menu_at).getTime() : null,
    menuChoice: row.menu_choice ?? null,
  };
}
