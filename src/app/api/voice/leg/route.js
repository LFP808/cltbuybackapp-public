import { webhookUrl } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { claimCall } from "@/lib/repositories/calls";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-leg callback: which assistant actually picked up.
 *
 * Every device rings at once, so the call-level status callback can only say
 * that SOMEONE answered. Each <Client> leg in the incoming TwiML carries its
 * own callback with the staff id in the query string, so the leg that reports
 * "answered" names the person.
 *
 * FIRST ANSWER WINS. Two legs can report within the same second - that is a
 * race, not a correction - so claimCall only writes when nobody has claimed it
 * yet, enforced in the update filter rather than in code here.
 */
export async function POST(request) {
  const url = new URL(request.url);
  const staffId = url.searchParams.get("staff");

  // The signed URL includes the query string Twilio was given — this callback
  // carries the staff id there, so unlike its siblings the path alone is wrong.
  const { params, forbidden } = await readTwilioWebhook(
    request,
    `${webhookUrl(request, "/api/voice/leg")}${url.search}`,
  );
  if (forbidden) return forbidden;

  // ParentCallSid is the customer's call; CallSid here is this leg.
  const parent = params.ParentCallSid || params.CallSid;
  const answered = (params.CallStatus || "") === "in-progress";

  if (answered && staffId && parent) {
    try {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", staffId)
        .maybeSingle();
      await claimCall(parent, {
        staffId,
        staffName: data?.full_name?.trim() || "Staff",
      });
    } catch (err) {
      console.error("Leg claim failed:", err?.message || err);
    }
  }

  return new Response(null, { status: 204 });
}
