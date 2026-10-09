import { runAppointmentSweep, appointmentSweepBlockedReason } from "@/lib/appointment-sweep";

/**
 * The appointment-reminder tick: day before, morning of, ~30 minutes ahead.
 *
 * Which lane an order is due, if any, is decided in domain/appointments.js on
 * the BUSINESS clock — this route only ticks. It is triggered every 15
 * minutes by a GitHub Actions workflow (.github/workflows/cron-appointments.yml)
 * because two of the three promises ("8am Eastern", "30 minutes before a 2pm
 * pickup") are local wall-clock moments that a once-a-day UTC cron cannot
 * hit, and DST moves them against UTC twice a year. NOTE: a sub-daily
 * vercel.json cron needs Vercel Pro, which is why the trigger lives in
 * GitHub Actions instead — see DEPLOYMENT.md "Cron triggers".
 *
 * Nearly every tick sends nothing: each lane is once-only per appointment
 * date via an activity marker, so running this by hand beside the schedule is
 * safe, and a sweep that was down for an hour catches up on its next tick
 * instead of skipping the day.
 *
 * PUBLIC ENDPOINT, gated exactly like /api/reminders — same secrets, same
 * refusal to run open, same reasons. Try it:
 *
 *   curl "$APP/api/appointments?dry=1" -H "Authorization: Bearer $REMINDERS_SECRET"
 */
export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}

async function run(request) {
  const accepted = [process.env.REMINDERS_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!accepted.length) {
    return json({ error: "REMINDERS_SECRET is not set; refusing to run." }, 503);
  }
  const offered = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!offered || !accepted.includes(offered)) return json({ error: "Unauthorized." }, 401);

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";

  // Same rule as the label sweep: with messaging off a send "succeeds"
  // without sending, and the marker would then burn each lane's once on a
  // text nobody received.
  const blocked = appointmentSweepBlockedReason();
  if (blocked && !dry) return json({ sent: {}, reason: blocked, skipped: 0 }, 200);

  const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 1000);

  try {
    const result = await runAppointmentSweep({ limit, dry });
    if (result.truncated) {
      console.warn(
        `Appointment sweep hit its ${limit}-order rail; some candidates were not examined.`,
      );
    }
    return json({ dry, ...result });
  } catch (err) {
    console.error("Appointment sweep failed:", err?.message || err);
    return json({ error: "Sweep failed.", detail: String(err?.message || err) }, 500);
  }
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}
