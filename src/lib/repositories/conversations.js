import { createClient } from "@/lib/supabase/server";
import { scopeOrders } from "@/lib/repositories/scope";
import { rowToMessage, rowToCall } from "@/lib/mappers";
import { normPhone } from "@/domain/format";
import { isOpen } from "@/domain/orders";

/**
 * Assemble the Messages inbox: one conversation per customer (keyed by
 * normalized phone), stitched together from shipments, manually-added
 * customers, site leads (device_inquiries), the messages table, and contact
 * notes.
 *
 * A handful of full-table reads joined in memory — appropriate for a
 * single-location business, and far simpler than per-conversation queries.
 *
 * @returns {Promise<Conversation[]>} sorted by most recent activity first
 *
 * @typedef {Object} OrderSummary
 * @property {string} id
 * @property {string} status
 * @property {string} type
 * @property {string} label     meetup date, or "Walk-in"
 * @property {number} [paidAmount]
 *
 * @typedef {Object} Conversation
 * @property {string} phone
 * @property {string} name
 * @property {string} initial
 * @property {import('@/domain/types').Message[]} messages
 * @property {import('@/domain/types').Message | null} lastMessage
 * @property {number} lastActivity
 * @property {number} unreadCount   unread inbound messages
 * @property {number} shipmentCount
 * @property {number} totalPaid
 * @property {OrderSummary[]} currentOrders
 * @property {OrderSummary[]} pastOrders
 * @property {string} notes
 * @property {string[]} tags
 */
export async function listConversations() {
  const supabase = await createClient();

  const [shipmentsRes, customersRes, inquiriesRes, messagesRes, notesRes, callsRes] =
    await Promise.all([
      scopeOrders(
        supabase
          .from("orders")
          .select(
            "id, name, phone, type, status, pickup_date, paid_amount, created_at, reminders_cancelled_at",
          )
          .order("created_at", { ascending: false }),
      ),
      supabase.from("manual_customers").select("name, phone, created_at"),
      // A lead from the site's quote wizard names itself before any order
      // exists. Without this, a lead who texts in before booking showed up
      // here as "Unknown" even though /leads already had their name.
      supabase.from("device_inquiries").select("name, phone, created_at"),
      supabase.from("messages").select("*").order("created_at", { ascending: true }),
      // Star select for the same reason as getContactNotes: naming the 0029
      // columns would take the whole inbox down until that migration is run.
      supabase.from("contact_notes").select("*"),
      // Loaded alongside messages rather than fetched per-contact: a call is the
      // same conversation by another channel, and the panel showing one has no
      // business round-tripping to show the other.
      supabase.from("calls").select("*").order("started_at", { ascending: false }),
    ]);

  for (const res of [shipmentsRes, customersRes, messagesRes, notesRes]) {
    if (res.error) throw res.error;
  }
  // Both calls and device_inquiries arrived after this app did. A deployment
  // where that migration hasn't run yet should still show conversations
  // rather than an error page — the lead-name lookup just degrades to
  // "Unknown" like before.
  if (callsRes.error) console.error("Calls unavailable:", callsRes.error.message);
  if (inquiriesRes.error)
    console.error("Device inquiries unavailable:", inquiriesRes.error.message);

  const callsByPhone = new Map();
  for (const row of callsRes.data ?? []) {
    const key = normPhone(row.phone);
    if (!key) continue;
    if (!callsByPhone.has(key)) callsByPhone.set(key, []);
    callsByPhone.get(key).push(rowToCall(row));
  }

  const notesByPhone = new Map(
    (notesRes.data ?? []).map((n) => [
      normPhone(n.phone),
      {
        name: n.name?.trim() || null,
        notes: n.notes ?? "",
        tags: n.tags ?? [],
        smsOptedOut: Boolean(n.sms_opted_out_at),
        leadSource: n.lead_source?.trim() || null,
        preferredPaymentMethod: n.preferred_payment_method?.trim() || null,
        paymentHandle: n.payment_handle?.trim() || null,
      },
    ]),
  );

  // A lead names itself on the wizard before any order or message exists, but
  // a lead alone must NOT open a conversation row — same rule as the
  // auto-text note below. So this is only ever consulted as a name FALLBACK
  // on a contact some other, real event already created; the most recent
  // submission per phone wins if someone filled the wizard out twice.
  const inquiryNameByPhone = new Map();
  for (const i of [...(inquiriesRes.data ?? [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at),
  )) {
    const key = normPhone(i.phone);
    if (key && i.name) inquiryNameByPhone.set(key, i.name);
  }

  /** @type {Map<string, any>} */
  const map = new Map();

  const ensure = (phone, name, createdAt) => {
    const key = normPhone(phone);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        phone: key,
        name: name || "Unknown",
        nameAt: createdAt || 0,
        shipments: [],
        messages: [],
      });
    }
    const c = map.get(key);
    // Keep the name from the most recent source that named this contact.
    if ((createdAt || 0) >= c.nameAt && name) {
      c.name = name;
      c.nameAt = createdAt || 0;
    }
    return c;
  };

  // Seed manual customers first so they appear even with no shipment/messages.
  for (const m of customersRes.data ?? []) {
    ensure(m.phone, m.name, new Date(m.created_at).getTime());
  }

  for (const s of shipmentsRes.data ?? []) {
    const c = ensure(s.phone, s.name, new Date(s.created_at).getTime());
    if (c) c.shipments.push(s);
  }

  // AN AUTO-TEXT ALONE DOES NOT OPEN A CONVERSATION (Jaime, 2026-08-10; the
  // same rule as the customers directory). Every unanswered call gets the
  // automatic "sorry we missed you" text, so every robocaller that rang once
  // used to appear here as an "Unknown" thread. A number earns its inbox row
  // by a message somebody MEANT — inbound, or typed by staff — and the auto
  // text then shows inside the thread like any other message. Computed as a
  // set up front rather than in the loop: the auto text predates the reply
  // that qualifies its number, and the loop runs oldest-first.
  const meantPhones = new Set(
    (messagesRes.data ?? [])
      .filter((row) => row.direction === "inbound" || !row.auto)
      .map((row) => normPhone(row.phone)),
  );

  for (const row of messagesRes.data ?? []) {
    const key = normPhone(row.phone);
    if (!map.has(key)) {
      if (!meantPhones.has(key)) continue; // machine-only thread — see above
      // A message to a number with no shipment/customer record yet.
      map.set(key, { phone: key, name: "Unknown", nameAt: 0, shipments: [], messages: [] });
    }
    map.get(key).messages.push(rowToMessage(row));
  }

  const conversations = [...map.values()].map((c) => {
    const messages = c.messages.sort((a, b) => a.at - b.at);
    const lastMessage = messages[messages.length - 1] || null;
    const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.readAt).length;
    const lastShipmentAt = c.shipments.reduce(
      (max, s) => Math.max(max, new Date(s.created_at).getTime()),
      0,
    );
    const lastActivity = Math.max(lastMessage?.at || 0, lastShipmentAt);

    const totalPaid = c.shipments.reduce(
      (sum, s) => sum + (s.status === "paid" ? Number(s.paid_amount) || 0 : 0),
      0,
    );

    const toSummary = (s) => ({
      id: s.id,
      status: s.status,
      type: s.type,
      // An office order without an appointment is a walk-in by definition.
      label: s.pickup_date || "Walk-in",
      paidAmount: s.paid_amount != null ? Number(s.paid_amount) : undefined,
    });

    // A corrected name beats the one derived from the newest order or manual
    // entry, which beats the one from a lead that never actually messaged in
    // (c.name only reads "Unknown" when neither of those ever named this
    // contact — see the comment on inquiryNameByPhone above).
    const name =
      notesByPhone.get(c.phone)?.name ||
      (c.name !== "Unknown" ? c.name : null) ||
      inquiryNameByPhone.get(c.phone) ||
      c.name;

    return {
      phone: c.phone,
      name,
      initial: (name || "?").trim()[0]?.toUpperCase() || "?",
      messages,
      lastMessage,
      lastActivity,
      unreadCount,
      shipmentCount: c.shipments.length,
      totalPaid,
      currentOrders: c.shipments.filter(isOpen).map(toSummary),
      pastOrders: c.shipments.filter((s) => !isOpen(s)).map(toSummary),
      calls: callsByPhone.get(c.phone) ?? [],
      notes: notesByPhone.get(c.phone)?.notes ?? "",
      tags: notesByPhone.get(c.phone)?.tags ?? [],
      leadSource: notesByPhone.get(c.phone)?.leadSource ?? null,
      preferredPaymentMethod: notesByPhone.get(c.phone)?.preferredPaymentMethod ?? null,
      paymentHandle: notesByPhone.get(c.phone)?.paymentHandle ?? null,
      // Texted STOP: the carrier blocks us, so the composer must say so
      // rather than letting staff type into a void.
      smsOptedOut: notesByPhone.get(c.phone)?.smsOptedOut ?? false,
      // PAUSE is the OTHER opt-out — automated chasing off, ordinary messages
      // fine — and the inbox is where staff type those ordinary messages, so
      // it has to know. Read off the RAW rows already loaded here (this loop
      // runs before the mapping boundary); the most recent one wins.
      remindersCancelledAt:
        c.shipments
          .map((s) => s.reminders_cancelled_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
    };
  });

  return conversations.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}
