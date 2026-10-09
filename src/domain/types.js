/**
 * @file Shared JSDoc typedefs for the business domain.
 *
 * There is no TypeScript in this project, but documenting the shapes in one
 * place gives editors autocomplete and keeps every module agreeing on the same
 * vocabulary. Import nothing from here — reference the types with JSDoc, e.g.
 * `@param {import('@/domain/types').Order} order`.
 */

/**
 * @typedef {"office"} OrderType
 *   One value today (a meetup at our address; walk-ins are the same type with
 *   the walkIn flag). Kept as a named type because queries, scopes and
 *   mappers all branch on it, and a second kind of order is a widened union
 *   here rather than a codebase hunt.
 * @typedef {"awaiting" | "received" | "paid" | "cancelled"} OrderStatus
 * @typedef {"in_stock" | "shipped" | "complete" | "disposed"} LotStatus
 *   in_stock "In Stock" → shipped "On Invoice" → complete "Sold" | disposed.
 * @typedef {string} PaymentMethod
 *   Free text; the offered list lives in app_settings under `payment_methods`
 *   (domain/constants PAYMENT_METHODS is the fallback).
 */

/**
 * The meetup spot — app_settings `office_address`, edited on /settings. Read
 * through lib/business.js (which supplies the OFFICE_* env fallback); shaped,
 * checked and formatted by domain/office.js.
 *
 * @typedef {Object} OfficeAddress
 * @property {string} street
 * @property {string} street2  Suite / unit; "" when none.
 * @property {string} city
 * @property {string} state    Two-letter code ("NC").
 * @property {string} zip      "" when none. Never texted; kept for documents.
 */

/**
 * What the customer SAYS they are bringing — the appointment is a promise,
 * and the exact devices land at check-in as lots.
 *
 * @typedef {Object} OrderItem
 * @property {string} id
 * @property {string} name
 * @property {number} quantity
 * @property {number} price   Per-unit buyback price in dollars.
 * @property {string} [condition] What the customer SAYS the condition is,
 *   picked from the grades ladder at booking (required on a meetup, see
 *   domain/validation.js). Check-in seeds each row's grade from it.
 * @property {string} [carrier] What the customer SAYS the carrier/lock status
 *   is, picked from the fixed CARRIERS list (domain/inventory.js). Optional,
 *   unlike condition — check-in's own lookup is the fact that sticks, this is
 *   just a head start. Check-in seeds each row's carrier from it.
 * @property {string} [note]   Internal per-line note; see ItemsCard.
 * @property {string} [noteBy]
 * @property {number} [noteAt]
 */

/**
 * @typedef {"inbound" | "outbound"} MessageDirection
 *
 * @typedef {Object} Message
 * @property {string} text
 * @property {number} at
 * @property {MessageDirection} direction  inbound = from the customer.
 * @property {boolean} [auto]     Sent automatically by a stage change (outbound).
 * @property {boolean} [testMode] Only logged, not really sent.
 * @property {string} [by]        Staff member attributed (outbound).
 * @property {string|null} [byRole] Their role AT SEND TIME.
 * @property {string|null} [mediaUrl]
 * @property {number|null} [readAt] When an inbound message was first opened.
 * @property {string|null} [deliveryStatus] Twilio's verdict, via the status webhook.
 * @property {string|null} [deliveryError]
 */

/**
 * @typedef {Object} ActivityEntry
 * @property {string} action
 * @property {string} by
 * @property {number} at
 */

/**
 * One customer order: a meetup (booked, or a walk-in recorded after the
 * handover).
 *
 * @typedef {Object} Order
 * @property {string} id
 * @property {OrderType} type
 * @property {OrderStatus} status
 * @property {string} name
 * @property {string} phone
 * @property {OrderItem[]} items What they say they're bringing.
 * @property {number} [estValue]
 * @property {number} [remindersCancelledAt] When the customer texted the PAUSE
 *   keyword: automated nudges (appointment reminders, review asks) stop;
 *   ordinary conversation keeps working. Distinct from carrier STOP.
 * @property {string} [pickupDate] The appointment day (YYYY-MM-DD).
 * @property {string} [pickupTime]
 * @property {number} [paidAmount]
 * @property {PaymentMethod} [paymentMethod]
 * @property {number} [paidAt]     When the payout actually left.
 * @property {number} [receivedAt] When the devices were handed over ("Bought").
 * @property {boolean} [walkIn] Turned up unannounced; recorded after the
 *   handover rather than booked. Only ever true alongside type "office".
 * @property {string} [payoutReason] Why paid differs from the estimate
 *   (graded lower, FMI on, blacklisted).
 * @property {string} [cancelReason]
 * @property {number} [cancelledAt]
 * @property {string} [stopOutcome] What happened at a meetup that produced no
 *   devices: "no_show" | "customer_cancelled". The order stays awaiting.
 * @property {string} [stopOutcomeNote]
 * @property {number} [stopOutcomeAt]
 * @property {number} [checkedInAt] When the devices were counted into
 *   inventory. A fact, not a status — the check-in queue derives from its
 *   absence.
 * @property {number} [deletedAt] An admin struck the order from the books:
 *   its lots were removed from inventory and its status set to cancelled so
 *   no money figure counts it. The row stays as a record (isDeleted,
 *   displayStage "deleted").
 * @property {string} [deletedBy]
 * @property {string} [deleteReason]
 * @property {Message[]} messages
 * @property {ActivityEntry[]} activity
 * @property {number} createdAt
 * @property {string} [createdBy]
 */

/**
 * A lot IS one physical device (quantity is always 1; sealed stacks checked
 * in with quantity N are expanded into N unit lots by the action).
 *
 * @typedef {Object} Lot
 * @property {string} id
 * @property {string} orderId
 * @property {string} item      Catalog name, e.g. "iPhone 15 Pro Max".
 * @property {string} [category]
 * @property {number} quantity  Always 1 — see above.
 * @property {string} [imei]    Unique when present; phones/cellular devices.
 * @property {string} [serial]  For devices without an IMEI (MacBooks).
 * @property {string} [carrier] Unlocked / AT&T / T-Mobile / Verizon / Other.
 * @property {string} [grade]   From app_settings `grades` (DEFAULT_GRADES fallback).
 * @property {Object} details   Sickw-pulled fact bag (model_desc, color,
 *   storage, sim_lock, fmi, blacklist, battery, raw). A bag, not columns.
 * @property {number} cog       Per-unit dollars, captured once at check-in.
 * @property {string} [boughtBy] Who did the buy — copied from the order at
 *   check-in, automatic from the login. The per-person P/L axis.
 * @property {LotStatus} status
 * @property {string} [invoiceId]
 * @property {number} [rate]      Per-unit asking price on the invoice line.
 * @property {number} [soldTotal] Actual sold dollars, written at settle — or
 *   at a direct (eBay) sale, which is `complete` with no invoiceId plus:
 * @property {number} [feeTotal]  Marketplace fees taken from the sale.
 * @property {string} [soldChannel] "eBay". Null on invoice sales.
 * @property {number} [soldAt]    Direct-sale recognition date (ms).
 * @property {number} [shipTotal] This lot's even share of invoice shipping.
 * @property {boolean} notOnOrder Arrived in the handover but no order line
 *   predicted it.
 * @property {number} [disposedAt]
 * @property {string} [disposeNote]
 * @property {ActivityEntry[]} edits Append-only audit of in-stock corrections
 *   ({ at, by, field, from, to }); lots lock once invoiced.
 * @property {string} [checkedInBy]
 * @property {number} createdAt
 * @property {{type: string, walkIn: boolean, name: string, phone: string,
 *   paymentMethod?: string}} [order]   Present when the query embedded it.
 * @property {{number: number, status: string, buyerName?: string}} [invoice]
 *   Present when the query embedded it.
 */

/**
 * @typedef {Object} Buyer
 * @property {string} id
 * @property {string} name
 * @property {string} [street]
 * @property {string} [street2] Apartment / unit / suite line.
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [zip]
 * @property {string} [terms]
 * @property {number} createdAt
 */

/**
 * @typedef {"shipped" | "complete" | "voided"} InvoiceStatus
 *   shipped "Sent" → complete "Settled" | voided (lots return to stock, the
 *   number stays burned).
 *
 * @typedef {Object} Invoice
 * @property {string} id
 * @property {number} number    From the invoice sequence; burned on void.
 * @property {string} buyerId
 * @property {InvoiceStatus} status
 * @property {number} projected Frozen at creation: sum of rate × qty.
 * @property {number} shipping  What it cost us to ship, spread per unit at settle.
 * @property {number} [paid]    Sum of the per-line actuals, stored at settle.
 * @property {string} [paidMethod]
 * @property {number} [paidAt]
 * @property {string} [note]
 * @property {number} [voidedAt]
 * @property {string} [createdBy]
 * @property {number} createdAt
 * @property {Buyer} [buyer]  Present when the query embedded it.
 * @property {Lot[]} [lots]   Present when the query embedded them.
 */

/**
 * @typedef {Object} Call
 * @property {string} id
 * @property {string} callSid
 * @property {"inbound" | "outbound"} direction
 * @property {string|null} fromNumber
 * @property {string|null} toNumber
 * @property {string|null} phone    Normalized customer number.
 * @property {string} status
 * @property {string|null} answeredBy   Staff profile id.
 * @property {string|null} answeredName
 * @property {boolean} toVoicemail
 * @property {number} startedAt
 * @property {number|null} endedAt
 * @property {number|null} durationSecs
 * @property {string|null} recordingUrl A conversation that already happened.
 * @property {string|null} transcript
 * @property {string|null} transcriptStatus
 * @property {string|null} voicemailUrl A message nobody has heard yet.
 * @property {number|null} voicemailSecs
 * @property {number|null} handledAt
 * @property {string|null} handledBy
 * @property {number|null} missedTextedAt When the missed-call follow-up text went.
 * @property {number|null} menuAt When the auto-answer (busy message / menu) picked up; null = it rang straight through.
 * @property {string|null} menuChoice What became of it: "told_to_text", or a domain/phone-menu.js menu key.
 */

/**
 * @typedef {Object} ManualCustomer
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 * @property {string} [street]
 * @property {string} [street2] Apartment / unit / suite line.
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [zip]
 * @property {number} createdAt
 * @property {string} [createdBy]
 */

/**
 * @typedef {Object} ContactNote
 * @property {string} notes
 * @property {string[]} tags
 */

export {};
