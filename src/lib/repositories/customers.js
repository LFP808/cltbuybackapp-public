import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scopeOrders } from "@/lib/repositories/scope";
import { normPhone } from "@/domain/format";
import { isOpen } from "@/domain/orders";
import { countKinds, customerKind, kindOf, kindSummary } from "@/domain/customer-kind";
import { listOrdersByPhone } from "@/lib/repositories/orders";
import { listMessagesByPhone } from "@/lib/repositories/messages";
import { getContactNotes } from "@/lib/repositories/contact-notes";
import { listCallsByPhone } from "@/lib/repositories/calls";

/**
 * The customer directory: one entry per person (keyed by normalized phone),
 * aggregated from shipments, manually-added customers, contact notes, and
 * message activity. This is the CRM's contact spine.
 *
 * @typedef {Object} CustomerSummary
 * @property {string} phone
 * @property {string} name
 * @property {string} initial
 * @property {string[]} tags
 * @property {number} shipmentCount
 * @property {number} openOrders     orders not yet paid
 * @property {number} totalPaid
 * @property {{key: string, label: string, local: boolean}} kind meetup vs walk-in habit
 * @property {number} messageCount
 * @property {number} unreadCount
 * @property {number} firstSeen
 * @property {number} lastActivity
 * @property {boolean} manualOnly     added by hand, no shipment yet
 */

/**
 * Every order, reduced to the columns the directory aggregates.
 *
 * Scoped: a restricted role's customer totals must be built from the orders
 * they can see, or the aggregates would leak what the list itself hides.
 *
 * Migrations are applied BY HAND here, and naming a column that isn't there
 * yet fails the whole SELECT — which would take the entire customer directory
 * down: a blank page for a flair. So a missing `walk_in` is caught and the
 * query re-run without it: walk-ins then read as meetups, which is very
 * nearly what they are, and the page still loads.
 */
async function ordersForDirectory(supabase) {
  const COLUMNS = "name, phone, status, paid_amount, created_at, type";
  const first = await scopeOrders(
    supabase.from("orders").select(`${COLUMNS}, walk_in`).order("created_at", { ascending: false }),
  );
  // 42703 is Postgres's undefined_column; PGRST204 is PostgREST refusing to
  // build the statement from its schema cache. Both mean the same thing here.
  if (first.error?.code !== "42703" && first.error?.code !== "PGRST204") return first;
  return scopeOrders(
    supabase.from("orders").select(COLUMNS).order("created_at", { ascending: false }),
  );
}

/** @returns {Promise<CustomerSummary[]>} sorted by most recent activity. */
export async function listCustomers() {
  const supabase = await createClient();

  const [shipmentsRes, customersRes, messagesRes, notesRes] = await Promise.all([
    ordersForDirectory(supabase),
    supabase.from("manual_customers").select("name, phone, created_at"),
    supabase.from("messages").select("phone, direction, read_at, created_at, auto"),
    supabase.from("contact_notes").select("phone, name, tags"),
  ]);

  for (const res of [shipmentsRes, customersRes, messagesRes, notesRes]) {
    if (res.error) throw res.error;
  }

  const tagsByPhone = new Map((notesRes.data ?? []).map((n) => [normPhone(n.phone), n.tags ?? []]));
  // A corrected name beats the one derived from the newest order.
  const nameByPhone = new Map(
    (notesRes.data ?? [])
      .filter((n) => n.name?.trim())
      .map((n) => [normPhone(n.phone), n.name.trim()]),
  );

  /** @type {Map<string, any>} */
  const map = new Map();
  const ensure = (phone, name, at, manual) => {
    const key = normPhone(phone);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        phone: key,
        name: name || "Unknown",
        nameAt: 0,
        manualOnly: manual,
        shipmentCount: 0,
        openOrders: 0,
        totalPaid: 0,
        messageCount: 0,
        unreadCount: 0,
        // How they come to us, tallied as the orders stream past. See
        // domain/customer-kind.js — the flair is derived from these, never
        // stored, so somebody who moves away stops being local on their own.
        kinds: countKinds([]),
        firstSeen: at || Date.now(),
        lastActivity: 0,
      });
    }
    const c = map.get(key);
    if ((at || 0) >= c.nameAt && name) {
      c.name = name;
      c.nameAt = at || 0;
    }
    if (at) {
      c.firstSeen = Math.min(c.firstSeen, at);
      c.lastActivity = Math.max(c.lastActivity, at);
    }
    if (!manual) c.manualOnly = false;
    return c;
  };

  for (const m of customersRes.data ?? []) {
    ensure(m.phone, m.name, new Date(m.created_at).getTime(), true);
  }

  for (const s of shipmentsRes.data ?? []) {
    const c = ensure(s.phone, s.name, new Date(s.created_at).getTime(), false);
    if (!c) continue;
    c.shipmentCount += 1;
    if (isOpen(s)) c.openOrders += 1;
    if (s.status === "paid") c.totalPaid += Number(s.paid_amount) || 0;
    // Counted per order rather than "their latest wins": someone who booked
    // three meetups and walked in once is both, and the newest order alone
    // would keep flipping their flair.
    const one = countKinds([s]);
    for (const key of Object.keys(c.kinds)) c.kinds[key] += one[key];
  }

  // AN AUTO-TEXT ALONE DOES NOT MAKE SOMEBODY A CUSTOMER (Jaime, 2026-08-10).
  // Every unanswered call gets an automatic "sorry we missed you" text, and
  // because this directory is derived from message rows, every robocaller
  // that rang once used to materialise here as "Unknown", forever. So only a
  // message somebody MEANT — inbound, or typed by staff — creates an entry; a
  // machine send merely joins whatever entry already exists. The moment the
  // caller replies, the inbound row creates the entry and the whole thread,
  // auto-texts included, counts as normal.
  //
  // Two passes, because the rows arrive in no particular order: qualifying
  // rows create entries first, then every row lands on whatever entry exists.
  // One pass undercounted — an auto text processed before the reply that
  // qualified its phone fell on an entry not yet created.
  for (const row of messagesRes.data ?? []) {
    if (row.direction === "inbound" || !row.auto) {
      ensure(row.phone, null, new Date(row.created_at).getTime(), false);
    }
  }
  for (const row of messagesRes.data ?? []) {
    const c = map.get(normPhone(row.phone));
    if (!c) continue;
    c.lastActivity = Math.max(c.lastActivity, new Date(row.created_at).getTime());
    c.messageCount += 1;
    if (row.direction === "inbound" && !row.read_at) c.unreadCount += 1;
  }

  return [...map.values()]
    .map((c) => ({
      phone: c.phone,
      name: nameByPhone.get(c.phone) || c.name,
      initial: (nameByPhone.get(c.phone) || c.name || "?").trim()[0]?.toUpperCase() || "?",
      tags: tagsByPhone.get(c.phone) ?? [],
      shipmentCount: c.shipmentCount,
      openOrders: c.openOrders,
      totalPaid: c.totalPaid,
      kind: customerKind(c.kinds),
      kindDetail: kindSummary(c.kinds),
      messageCount: c.messageCount,
      unreadCount: c.unreadCount,
      firstSeen: c.firstSeen,
      lastActivity: c.lastActivity,
      manualOnly: c.manualOnly,
    }))
    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

/** Every distinct tag in use, sorted — for the segment filter. */
export async function listCustomerTags() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contact_notes").select("tags");
  if (error) throw error;
  const set = new Set();
  for (const row of data ?? []) for (const t of row.tags ?? []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Full detail for one customer: identity, notes/tags, order history, and
 * message history. Composed from the focused repositories.
 *
 * @returns {Promise<null | { phone, name, initial, notes, tags, shipments, messages, totalPaid, shipmentCount, firstSeen, lastActivity }>}
 */
export async function getCustomer(phone) {
  const key = normPhone(phone);
  if (key.length !== 10) return null;

  const supabase = await createClient();
  const [shipments, messages, notes, manualRes, calls] = await Promise.all([
    listOrdersByPhone(key),
    listMessagesByPhone(key),
    getContactNotes(key),
    supabase
      .from("manual_customers")
      .select("name, created_at")
      .eq("phone", key)
      .order("created_at")
      .limit(1),
    // Tolerated rather than awaited strictly: the calls table arrived after
    // this app did, and a deployment where 0012 hasn't run should still open
    // a customer rather than 500.
    listCallsByPhone(key).catch((err) => {
      console.error("Calls unavailable:", err?.message || err);
      return [];
    }),
  ]);

  const manual = manualRes.data?.[0] || null;
  if (shipments.length === 0 && messages.length === 0 && !manual) return null;

  // The override wins; otherwise the newest order names them.
  const name = notes.name || shipments[0]?.name || manual?.name || "Unknown";
  const totalPaid = shipments
    .filter((s) => s.status === "paid")
    .reduce((sum, s) => sum + (Number(s.paidAmount) || 0), 0);

  const times = [
    ...shipments.map((s) => s.createdAt),
    ...messages.map((m) => m.at),
    manual ? new Date(manual.created_at).getTime() : 0,
  ].filter(Boolean);

  return {
    phone: key,
    name,
    initial: (name || "?").trim()[0]?.toUpperCase() || "?",
    notes: notes.notes,
    tags: notes.tags,
    leadSource: notes.leadSource,
    preferredPaymentMethod: notes.preferredPaymentMethod,
    paymentHandle: notes.paymentHandle,
    // Texted STOP: every composer needs to know, not just the inbox.
    smsOptedOut: Boolean(notes.smsOptedOutAt),
    shipments,
    messages,
    calls,
    totalPaid,
    // The same derivation the directory uses, from the same function — the
    // list and the page must never disagree about whether somebody is local.
    kind: kindOf(shipments),
    kindDetail: kindSummary(countKinds(shipments)),
    shipmentCount: shipments.length,
    firstSeen: times.length ? Math.min(...times) : Date.now(),
    lastActivity: times.length ? Math.max(...times) : Date.now(),
  };
}

/**
 * Erase a contact from every table that knows the phone number.
 *
 * ADMIN CLIENT, because row-level security has no DELETE policies on most of
 * these tables — deliberately: routine staff work never deletes. The ACTION
 * that calls this is the gate (admin role only), and it has already refused
 * any phone with money history; by the time this runs, the orders in
 * `orderIds` are awaiting or cancelled, and everything else is conversation
 * debris (messages, calls, notes, a manual directory entry).
 *
 * @param {string} phone normalized 10 digits
 * @param {string[]} orderIds the orders the caller verified are safe to drop
 */
export async function deleteContactEverywhere(phone, orderIds) {
  const supabase = createAdminClient();
  const results = {};
  // `col` is each table's counting column: contact_notes is keyed by phone
  // and HAS no id, and selecting one from a delete throws - which stopped
  // this sequence halfway on the first run (messages gone, orders kept).
  const wipe = async (table, query, col = "id") => {
    const { data, error } = await query.select(col);
    if (error) throw error;
    results[table] = (data ?? []).length;
  };
  await wipe("messages", supabase.from("messages").delete().eq("phone", phone));
  await wipe("calls", supabase.from("calls").delete().eq("phone", phone));
  await wipe("contact_notes", supabase.from("contact_notes").delete().eq("phone", phone), "phone");
  await wipe(
    "manual_customers",
    supabase.from("manual_customers").delete().eq("phone", phone),
    "phone",
  );
  if (orderIds.length) {
    await wipe("orders", supabase.from("orders").delete().in("id", orderIds));
  } else {
    results.orders = 0;
  }
  return results;
}
