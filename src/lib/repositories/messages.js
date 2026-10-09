import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToMessage } from "@/lib/mappers";
import { normPhone } from "@/domain/format";

/** Record an outbound message (already sent or logged) against a phone/order. */
export async function addMessage({
  phone,
  orderId,
  body,
  mediaUrl,
  auto,
  testMode,
  sentBy,
  sentByRole = null,
  direction = "outbound",
  providerSid = null,
  deliveryStatus = null,
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      phone: normPhone(phone),
      order_id: orderId ?? null,
      body: body ?? "",
      media_url: mediaUrl ?? null,
      auto: !!auto,
      test_mode: !!testMode,
      sent_by: sentBy ?? null,
      sent_by_role: sentByRole ?? null,
      direction,
      provider_sid: providerSid,
      delivery_status: deliveryStatus,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToMessage(data);
}

/**
 * Record a message from a context with no signed-in user — the scheduled
 * reminder sweep and the Twilio inbound webhook.
 *
 * Same row as addMessage, written with the service role. Necessary because RLS
 * grants the messages table to `authenticated` only, and a scheduler has no
 * session to present. Kept as a separate, explicitly named function so
 * bypassing RLS is always a deliberate choice at the call site.
 */
export async function addSystemMessage(fields) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      phone: normPhone(fields.phone),
      order_id: fields.orderId ?? null,
      body: fields.body ?? "",
      media_url: fields.mediaUrl ?? null,
      auto: !!fields.auto,
      test_mode: !!fields.testMode,
      sent_by: fields.sentBy ?? null,
      sent_by_role: fields.sentByRole ?? null,
      direction: fields.direction ?? "outbound",
      provider_sid: fields.providerSid ?? null,
      delivery_status: fields.deliveryStatus ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToMessage(data);
}

/** Total unread inbound messages across all conversations (for the nav badge). */
export async function countUnreadMessages() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * The most recent unread replies, newest first, for the notification bell.
 *
 * Names are resolved in a second pass rather than joined: a message only
 * carries a phone number, and who that number belongs to lives across several
 * tables. Small `in` queries against the handful of phones on screen beat
 * loading every conversation to answer it.
 *
 * @param {number} [limit] how many to show in the dropdown
 */
export async function listUnreadInbound(limit = 8) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, phone, body, media_url, created_at")
    .eq("direction", "inbound")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const phones = [...new Set(rows.map((r) => normPhone(r.phone)))];
  const [ordersRes, manualRes, inquiriesRes, notesRes] = await Promise.all([
    // Oldest first so the newest name for a number is the one that sticks:
    // people give a different version of their name over time.
    supabase
      .from("orders")
      .select("name, phone, created_at")
      .in("phone", phones)
      .order("created_at", { ascending: true }),
    supabase.from("manual_customers").select("name, phone").in("phone", phones),
    // A lead from the site's quote wizard, read last so an order or manual
    // entry still wins — but it's all there is for someone who texts in
    // before ever booking, and the alternative was "Unknown number" forever.
    supabase.from("device_inquiries").select("name, phone").in("phone", phones),
    // The explicit correction wins over everything derived — same priority
    // as the full Messages inbox (lib/repositories/conversations.js).
    supabase.from("contact_notes").select("name, phone").in("phone", phones),
  ]);

  const names = new Map();
  for (const r of [
    ...(manualRes.data ?? []),
    ...(ordersRes.data ?? []),
    ...(inquiriesRes.data ?? []),
  ]) {
    if (r.name) names.set(normPhone(r.phone), r.name);
  }
  for (const r of notesRes.data ?? []) {
    if (r.name?.trim()) names.set(normPhone(r.phone), r.name.trim());
  }

  return rows.map((r) => ({
    id: r.id,
    phone: normPhone(r.phone),
    name: names.get(normPhone(r.phone)) || "Unknown number",
    // An MMS with no caption is still something to look at, so it needs a line
    // of its own rather than an empty row.
    body: (r.body || "").trim() || (r.media_url ? "Sent a photo" : ""),
    createdAt: r.created_at,
  }));
}

/** Mark all unread inbound messages for a phone as read. */
export async function markConversationRead(phone) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("phone", normPhone(phone))
    .eq("direction", "inbound")
    .is("read_at", null);
  if (error) throw error;
}

/** All messages for a phone number, oldest first. */
export async function listMessagesByPhone(phone) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("phone", normPhone(phone))
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToMessage);
}
