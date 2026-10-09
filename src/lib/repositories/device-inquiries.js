import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToDeviceInquiry } from "@/lib/mappers";
import { fetchAllRows } from "@/lib/repositories/all-rows";
import { setLeadSourceIfEmpty } from "@/lib/repositories/contact-notes";
import { inquiryLeadSourceLabel } from "@/domain/device-inquiries";

/**
 * Leads from the marketing site's quote wizard, triaged on /leads. See
 * domain/device-inquiries.js for what belongs here.
 */

/** Every inquiry, newest first. */
export async function listDeviceInquiries() {
  const supabase = await createClient();
  const { rows, truncated } = await fetchAllRows((from, to) =>
    supabase
      .from("device_inquiries")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const inquiries = rows.reverse().map(rowToDeviceInquiry);
  inquiries.truncated = truncated;
  return inquiries;
}

/** Count of unworked leads, for the sidebar badge and the realtime bell. */
export async function countNewDeviceInquiries() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("device_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) throw error;
  return count || 0;
}

/** Staff triage: change status and/or edit the notes field. */
export async function updateDeviceInquiry({ id, status, notes }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("device_inquiries")
    .update({ status, notes: notes || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToDeviceInquiry(data);
}

/**
 * Auto-advance a lead from "new" to "contacted" on its first staff reply.
 *
 * A compare-and-swap, same shape as every other lifecycle transition in this
 * app: the WHERE clause is the guard, not a read-then-write, so it can't
 * race with someone closing the lead in another tab and can't touch `notes`
 * — only status + updated_at — so it never clobbers a draft someone has
 * typed into the notes field elsewhere.
 *
 * @returns the updated row, or null if it wasn't "new" (nothing to do, not a failure)
 */
export async function markDeviceInquiryContacted(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("device_inquiries")
    .update({ status: "contacted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "new")
    .select("*");
  if (error) throw error;
  return data?.length ? rowToDeviceInquiry(data[0]) : null;
}

/**
 * Write a new inquiry from the public, unauthenticated website POST.
 *
 * Uses the service-role client on purpose: grants revoke write access from
 * `anon` project-wide (0001_init.sql section 17 — "no anonymous surface in
 * this app"), so there is no RLS policy an unauthenticated caller could ever
 * satisfy. This is the one unauthenticated write path in the whole app,
 * alongside the sweeps/Twilio webhooks/digest that lib/supabase/admin.js
 * already documents as legitimate admin-client callers — kept in this same
 * repository file (not a separate module) so it's easy to find during a
 * security read, not buried behind a different name.
 */
export async function createDeviceInquiry(input) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("device_inquiries").insert({
    name: input.name,
    phone: input.phone,
    sms_consent: input.smsConsent === "yes" || input.smsConsent === true,
    source_page: input.sourcePage || null,
    ad_params: input.adParams || null,
    brand: input.brand || null,
    model: input.model || null,
    carrier: input.carrier || null,
    condition: input.condition || null,
    issues: input.issues || null,
    sell_method: input.sellMethod || null,
    item_count: Number(input.itemCount) || 1,
    device_summary: input.deviceSummary || null,
  });
  if (error) throw error;

  // Same "first-order-wins" fact the booking form's "how did they hear about
  // us?" writes (setLeadSourceIfEmpty never overwrites an existing value) —
  // this is the only thing that makes a lead's origin show up anywhere
  // outside /leads itself: the Source & payment panel and the messages-inbox
  // badge both read contact_notes.lead_source, not this table.
  await setLeadSourceIfEmpty(input.phone, inquiryLeadSourceLabel(input.adParams));
}
