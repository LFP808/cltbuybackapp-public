import { isOverdueLocal, needsAnotherAttempt, stopOutcomeLabel } from "./orders";
import { needsCheckIn, invoiceNumber } from "./inventory";
import { needsFollowUp as callNeedsFollowUp } from "./calls";
import { canAccess } from "./access";

/**
 * What is waiting on somebody, gathered into one list.
 *
 * Every rule here ALREADY EXISTED - isOverdueLocal, needsCheckIn, the call
 * follow-up test. They were each true on their own screen and nowhere
 * together, so knowing what the day owed you meant opening five pages and
 * remembering to. This file composes them and adds nothing: a rule restated
 * here would be a second definition free to drift from the first, and the
 * queue on /inventory and the count in the digest have to be the same number
 * or nobody believes either.
 *
 * The only genuinely new rules are the unsettled invoice ("sent a while ago
 * and never paid for" was not a question any screen asked) and aging stock -
 * a phone loses value every week it sits, which is this business's version
 * of an expiration date.
 */

/** An invoice can sit unsettled this long before it is somebody's problem. */
export const UNSETTLED_AFTER_DAYS = 14;

/** In-stock devices older than this get flagged: electronics only get cheaper. */
export const AGING_STOCK_DAYS = 30;

const DAY = 86400000;

/**
 * URGENT is "somebody is waiting on us right now" - a customer who left a
 * message, a buyer's money we have not chased. DUE is work that has piled up.
 * The split exists so the digest can lead with the first kind; a list that
 * treats a voicemail and a slightly aged device as equally loud trains people
 * to skim past both.
 */
const URGENT = "urgent";
const DUE = "due";

/**
 * @param {object} input
 * @param {object[]} [input.orders]
 * @param {object[]} [input.invoices]
 * @param {object[]} [input.lots]
 * @param {object[]} [input.calls]
 * @param {number} [input.now]
 * @param {string} [input.role] when given, drop anything this role cannot open
 * @returns {Array<{key:string,label:string,detail:string,href:string,severity:string,count:number,items:object[]}>}
 */
export function buildAttention({
  orders = [],
  invoices = [],
  lots = [],
  calls = [],
  now = Date.now(),
  role = null,
} = {}) {
  const sections = [
    section({
      key: "voicemails",
      severity: URGENT,
      href: "/calls",
      items: calls.filter(callNeedsFollowUp),
      label: (n) => `${n} call${n === 1 ? "" : "s"} to return`,
      detail: "Missed, or left a message, and nobody has marked it handled.",
      name: (c) => c.phone || c.fromNumber || "Unknown number",
    }),

    section({
      key: "unsettled",
      severity: URGENT,
      href: "/invoices",
      items: invoices.filter((inv) => isUnsettled(inv, now)),
      label: (n) => `${n} invoice${n === 1 ? "" : "s"} unpaid`,
      detail: `Sent more than ${UNSETTLED_AFTER_DAYS} days ago and still not settled.`,
      name: (inv) => `${invoiceNumber(inv.number)}${inv.buyer?.name ? ` - ${inv.buyer.name}` : ""}`,
    }),

    section({
      key: "checkins",
      severity: DUE,
      href: "/inventory",
      items: orders.filter(needsCheckIn),
      label: (n) => `${n} buy${n === 1 ? "" : "s"} to check in`,
      detail: "Bought but never scanned into inventory. The IMEIs are the audit.",
      name: (o) => o.name,
    }),

    section({
      key: "failed_stops",
      severity: URGENT,
      href: "/",
      items: orders.filter(needsAnotherAttempt),
      label: (n) => `${n} no-show${n === 1 ? "" : "s"} to rebook`,
      detail: "The meetup didn't happen. Text or call to set a new time.",
      name: (o) => `${o.name} (${stopOutcomeLabel(o.stopOutcome)})`,
    }),

    section({
      key: "overdue_meetups",
      severity: URGENT,
      href: "/calendar",
      // A reported no-show is the better explanation, so it is not ALSO
      // counted here - one order, one line, or the badge inflates and the
      // same name reads twice in the morning digest.
      items: orders.filter((o) => isOverdueLocal(o, now) && !needsAnotherAttempt(o)),
      label: (n) => `${n} meetup${n === 1 ? "" : "s"} past its date`,
      detail: "Scheduled for a day that has gone by, and still awaiting.",
      name: (o) => `${o.name}${o.pickupDate ? ` (${o.pickupDate})` : ""}`,
    }),

    section({
      key: "aging_stock",
      severity: DUE,
      href: "/inventory",
      items: lots.filter(
        (l) => l.status === "in_stock" && now - (l.createdAt ?? now) > AGING_STOCK_DAYS * DAY,
      ),
      label: (n) => `${n} device${n === 1 ? "" : "s"} aging in stock`,
      detail: `In stock over ${AGING_STOCK_DAYS} days. Worth less every week it sits.`,
      name: (l) => `${l.item}${l.imei ? ` (${l.imei})` : ""}`,
    }),
  ];

  // Nothing here should tell somebody about work behind a door they cannot
  // open. ROUTE_ACCESS is the single permissions table and stays that way -
  // this asks it rather than keeping its own idea of who sees invoices.
  return sections.filter((s) => s && (!role || canAccess(role, s.href)));
}

/** Sent, not settled, and old enough that nobody is still "getting to it". */
export function isUnsettled(invoice, now = Date.now()) {
  if (invoice?.status !== "shipped") return false;
  return now - (invoice.createdAt ?? now) > UNSETTLED_AFTER_DAYS * DAY;
}

/** Nothing to say is said by returning nothing, not by an empty card. */
function section({ key, severity, href, items, label, detail, name }) {
  if (!items.length) return null;
  return {
    key,
    severity,
    href,
    count: items.length,
    label: label(items.length),
    detail,
    // Enough to recognise the row without opening it, and capped: a digest
    // listing forty names is a digest nobody reads.
    items: items.slice(0, 5).map((item) => ({ id: item.id, name: name(item) })),
    more: Math.max(0, items.length - 5),
  };
}

/** Everything waiting, as one number - what a badge shows. */
export function attentionCount(sections) {
  return sections.reduce((sum, s) => sum + s.count, 0);
}

/** Whether anything is urgent enough to lead with. */
export function hasUrgent(sections) {
  return sections.some((s) => s.severity === URGENT);
}

export { URGENT, DUE };
