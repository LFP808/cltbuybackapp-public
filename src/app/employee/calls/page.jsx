import { PageTitle, Card } from "@/components/ui";
import { CallLog } from "@/components/employee/calls/CallLog";
import { listCalls } from "@/lib/repositories/calls";
import { isVoiceConfigured } from "@/lib/twilio/access-token";

/**
 * Every call, live.
 *
 * Ringing calls appear here before anyone answers, which is the point: an
 * assistant who missed the ring can see it happening and pick it up from their
 * own browser rather than finding out about it in a voicemail an hour later.
 */
export default async function CallsPage() {
  let calls = [];
  let dbError = null;
  try {
    calls = await listCalls();
  } catch (err) {
    dbError = err?.message || "Could not load calls.";
  }

  return (
    <div className="max-w-4xl">
      <PageTitle>Calls</PageTitle>

      {!isVoiceConfigured() && (
        <Card className="mb-3 text-[13px] text-muted">
          <p className="mb-1 font-semibold text-ink">Browser calling isn&apos;t switched on yet.</p>
          <p>
            The log below still records calls that reach the business number, and an admin&apos;s
            &quot;Call back&quot; goes through their own cell instead. To answer calls in the
            browser, set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and TWILIO_TWIML_APP_SID.
          </p>
        </Card>
      )}

      {dbError ? (
        <Card className="text-[13.5px] text-muted">
          <p className="mb-2 font-semibold text-ink">Call log unavailable.</p>
          <p>Run the migrations to create the calls table. ({dbError})</p>
        </Card>
      ) : (
        <CallLog initialCalls={calls} />
      )}
    </div>
  );
}
