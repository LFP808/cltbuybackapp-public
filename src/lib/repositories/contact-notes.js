import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normPhone } from "@/domain/format";

/**
 * Fetch a contact's name override, notes, tags, opt-out state, and the 0029
 * profile facts (lead source, payment preference).
 *
 * select("*") RATHER THAN NAMED COLUMNS, deliberately: naming the 0029
 * columns makes this read THROW until that migration is hand-run, taking the
 * order page and the customer page down with it. A star select returns
 * whatever columns exist, the missing ones read as undefined, and every
 * screen keeps working — the same degradation rule payoutAt() follows.
 */
export async function getContactNotes(phone) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_notes")
    .select("*")
    .eq("phone", normPhone(phone))
    .maybeSingle();
  if (error) throw error;
  return {
    // Null, not "": callers fall back to the derived name, and an empty string
    // would override it with nothing.
    name: data?.name?.trim() || null,
    notes: data?.notes ?? "",
    tags: data?.tags ?? [],
    smsOptedOutAt: data?.sms_opted_out_at ? new Date(data.sms_opted_out_at).getTime() : null,
    leadSource: data?.lead_source?.trim() || null,
    preferredPaymentMethod: data?.preferred_payment_method?.trim() || null,
    paymentHandle: data?.payment_handle?.trim() || null,
  };
}

/**
 * Save the 0029 profile facts. Empty strings store as null — "cleared" and
 * "never recorded" are the same fact here, unlike the name override above.
 */
export async function saveContactProfile(
  phone,
  { leadSource, preferredPaymentMethod, paymentHandle },
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("contact_notes").upsert(
    {
      phone: normPhone(phone),
      lead_source: String(leadSource || "").trim() || null,
      preferred_payment_method: String(preferredPaymentMethod || "").trim() || null,
      payment_handle: String(paymentHandle || "").trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );
  if (error) throw error;
}

/**
 * Record where a customer came from, ONLY if nothing is recorded yet.
 *
 * The intake form calls this: "initially" is the whole point of a lead
 * source, so a repeat order must never overwrite what the first one said.
 * Best-effort by design — it rides createOrderAction, and an order must
 * never fail because a marketing fact could not be written (0029 not run
 * yet included).
 */
export async function setLeadSourceIfEmpty(phone, source) {
  const clean = String(source || "").trim();
  if (!clean) return;
  try {
    const supabase = createAdminClient();
    const key = normPhone(phone);
    const { data } = await supabase
      .from("contact_notes")
      .select("*")
      .eq("phone", key)
      .maybeSingle();
    if (data?.lead_source?.trim()) return;
    const { error } = await supabase
      .from("contact_notes")
      .upsert(
        { phone: key, lead_source: clean, updated_at: new Date().toISOString() },
        { onConflict: "phone" },
      );
    if (error) throw error;
  } catch (err) {
    console.error(`Lead source write failed for ${phone}:`, err?.message || err);
  }
}

/**
 * Set or clear a contact's display name.
 *
 * Clearing (empty string) writes null rather than "", which restores the
 * derived name instead of blanking the contact — the only sensible reading of
 * emptying the field.
 */
export async function saveContactName(phone, name) {
  const supabase = await createClient();
  const { error } = await supabase.from("contact_notes").upsert(
    {
      phone: normPhone(phone),
      name: String(name || "").trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );
  if (error) throw error;
}

/**
 * Whether this number has texted STOP. Read before every send so a blocked
 * number produces a clear message instead of a carrier rejection.
 *
 * Uses the service role: the send path runs from webhooks and background work
 * as well as from a signed-in employee.
 */
export async function isSmsOptedOut(phone) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("contact_notes")
    .select("sms_opted_out_at")
    .eq("phone", normPhone(phone))
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.sms_opted_out_at);
}

/**
 * Record (or clear) an SMS opt-out.
 *
 * Written with the service role because the two things that discover an opt-out
 * — a failed send and Twilio's status callback — can both happen with no
 * signed-in user. Upserts so a contact with no notes row still gets flagged.
 */
export async function setSmsOptedOut(phone, optedOut, now = Date.now()) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("contact_notes").upsert(
    {
      phone: normPhone(phone),
      sms_opted_out_at: optedOut ? new Date(now).toISOString() : null,
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: "phone" },
  );
  if (error) throw error;
}

/** Upsert a contact's notes + tags. */
export async function saveContactNotes(phone, { notes, tags }) {
  const supabase = await createClient();
  const { error } = await supabase.from("contact_notes").upsert(
    {
      phone: normPhone(phone),
      notes: notes ?? "",
      tags: tags ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );
  if (error) throw error;
}
