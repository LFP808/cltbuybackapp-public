import { runReminderSweep, sweepBlockedReason } from "@/lib/reminder-sweep";

/**
 * The daily CRM sweep: two once-only texts, on one pass.
 *
 *   - the "still want to sell?" follow-up, two days after a missed meetup
 *   - the once-ever Google review ask, one business day after a customer's
 *     FIRST payout (off entirely while GOOGLE_REVIEW_URL is empty)
 *
 * Which one an order is due for is decided in domain/orders.js, not here.
 *
 * PUBLIC ENDPOINT, gated by a shared secret rather than a session, exactly like
 * /api/digest — a scheduler has no cookies. With no secret set it refuses
 * outright rather than defaulting to open: an unauthenticated route that sends
 * SMS is a way for a stranger to spend money on our Twilio account, and "nobody
 * knows the URL" is not a control. This one sends to CUSTOMERS rather than to
 * us, so the same rule matters more here than it does there.
 *
 * TRIGGERED at 15:00 UTC by a GitHub Actions workflow
 * (.github/workflows/cron-reminders.yml — see DEPLOYMENT.md "Cron triggers").
 * That is 11am Eastern in summer and 10am in winter, which is the point of
 * choosing it: a fixed UTC hour drifts by one across DST, so it has to be an
 * hour that is still comfortably inside the daytime at both ends. Overnight
 * texts to customers are the thing this must never do.
 *
 * WHAT STOPS IT REPEATING. Nothing in this route — each lane writes an
 * activity marker after its text really went, and needsStopFollowUp() /
 * needsReviewAsk() (domain/orders.js) read the marker back and refuse a
 * second send. Running this twice in one day therefore sends one text, not
 * two, and running it by hand while the schedule also fires is safe.
 *
 * Run it on demand while developing, which is the only sane way to work on
 * something that texts people:
 *
 *   curl "$APP/api/reminders?dry=1" -H "Authorization: Bearer $REMINDERS_SECRET"
 *
 * `dry=1` reports exactly who WOULD be texted, and claims nothing.
 */
export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}

async function run(request) {
  // CRON_SECRET is shared with the GitHub Actions workflow that triggers this
  // route (same value, kept in Vercel's env and the repo's Actions secrets),
  // so the daily trigger needs no secret of its own. REMINDERS_SECRET is for
  // calling it yourself. Either is sufficient; both are server-side
  // environment variables.
  const accepted = [process.env.REMINDERS_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!accepted.length) {
    return json({ error: "REMINDERS_SECRET is not set; refusing to run." }, 503);
  }
  const offered = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!offered || !accepted.includes(offered)) return json({ error: "Unauthorized." }, 401);

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";

  // CHECKED HERE RATHER THAN LEFT TO sendSms. With messaging off, a send returns
  // a fulfilled success shape without sending anything — so the sweep would
  // write every once-only marker, report a good morning's work, and burn each
  // customer's single follow-up or review ask on a text nobody received.
  const blocked = sweepBlockedReason();
  if (blocked && !dry) return json({ sent: 0, reason: blocked, skipped: 0 }, 200);

  const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 1000);

  try {
    const result = await runReminderSweep({ limit, dry });
    if (result.truncated) {
      console.warn(
        `Reminder sweep hit its ${limit}-order rail; some candidates were not examined.`,
      );
    }
    return json({ dry, ...result });
  } catch (err) {
    // A failed sweep must be loud: this is the one path where silence looks
    // exactly like a quiet day.
    console.error("Reminder sweep failed:", err?.message || err);
    return json({ error: "Sweep failed.", detail: String(err?.message || err) }, 500);
  }
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}
