import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who a bare phone number belongs to, by the same precedence the app shows
 * everywhere: the contact_notes override wins, then the newest order's name,
 * then the manual-customer record.
 *
 * Extracted from /api/voice/bridge (which announces "Connecting you to X")
 * when the inbound-text alert needed the identical answer — one copy, so the
 * call announcement and the text alert can never disagree about who someone
 * is.
 *
 * BEST EFFORT, NEVER THROWS. Every caller uses the name as a courtesy on top
 * of work that must not fail for want of it — a failed read falls through to
 * null and the caller says "the customer" or shows the number.
 *
 * @param {string} digits ten-digit phone, already normalised
 * @returns {Promise<string|null>}
 */
export async function customerNameByPhone(digits) {
  try {
    const supabase = createAdminClient();
    const [notes, order, manual] = await Promise.all([
      supabase.from("contact_notes").select("name").eq("phone", digits).maybeSingle(),
      supabase
        .from("orders")
        .select("name")
        .eq("phone", digits)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("manual_customers").select("name").eq("phone", digits).limit(1).maybeSingle(),
    ]);
    return (
      notes.data?.name?.trim() || order.data?.name?.trim() || manual.data?.name?.trim() || null
    );
  } catch (err) {
    console.error("Customer name lookup failed:", err?.message || err);
    return null;
  }
}
