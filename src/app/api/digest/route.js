import { sendSms } from "@/lib/twilio/client";
import { readDigestInputs, digestRecipients } from "@/lib/repositories/digest";
import { buildAttention, attentionCount } from "@/domain/attention";
import { digestText, shouldSendDigest } from "@/domain/digest";
import { normPhone } from "@/domain/format";

/**
 * The morning digest: one text to each admin, listing what is waiting.
 *
 * PUBLIC ENDPOINT, so it is gated by a shared secret rather than a session — a
 * scheduler has no cookies. Without DIGEST_SECRET set it refuses outright
 * instead of defaulting to open: an unauthenticated route that sends SMS is a
 * way for a stranger to spend money on our Twilio account, and "nobody knows
 * the URL" is not a control.
 *
 * TRIGGERED at 12:00 UTC / 8am ET by a GitHub Actions workflow
 * (.github/workflows/cron-digest.yml — see DEPLOYMENT.md "Cron triggers"),
 * which sends `Authorization: Bearer $CRON_SECRET`, same as Vercel's own
 * scheduler did before the trigger moved — which is why GET is accepted and
 * why CRON_SECRET is honoured below. CRON_SECRET must be set in the
 * deployment (and mirrored as a GitHub Actions secret) or the daily run 401s
 * silently and the digest simply never arrives.
 *
 * It also runs on demand, which is the only sane way to develop something that
 * texts people:
 *
 *   curl "$APP/api/digest?dry=1" -H "Authorization: Bearer $DIGEST_SECRET"
 *
 * `dry=1` builds the message and reports exactly who WOULD get it without
 * sending, which is the only sane way to develop something that texts people.
 */
export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}

async function run(request) {
  // CRON_SECRET is shared with the GitHub Actions workflow that triggers this
  // route (same value, kept in Vercel's env and the repo's Actions secrets).
  // Accepting it means the daily trigger needs no second copy of a secret kept
  // in sync by hand. Either is sufficient; both are server-side environment
  // variables, so neither is attacker-controlled.
  const accepted = [process.env.DIGEST_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!accepted.length) {
    return json({ error: "DIGEST_SECRET is not set; refusing to run." }, 503);
  }
  const offered = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!offered || !accepted.includes(offered)) return json({ error: "Unauthorized." }, 401);

  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const { orders, invoices, lots, calls, failedReads } = await readDigestInputs();
  // Built for an admin, because that is who receives it. See repositories/digest.
  const sections = buildAttention({ orders, invoices, lots, calls, role: "admin" });

  if (!shouldSendDigest(sections, failedReads)) {
    // Silence is the signal. A digest that arrives every day including the
    // quiet ones becomes a notification people swipe away unread, and then
    // they swipe away the one that mattered. (A failed read forces a send —
    // see shouldSendDigest — because that silence would be a lie.)
    return json({ sent: 0, reason: "nothing waiting", count: 0 });
  }

  const body = digestText(sections, new Date(), failedReads);
  const recipients = await digestRecipients();

  if (dry) {
    return json({
      dry: true,
      body,
      count: attentionCount(sections),
      failedReads,
      sections: sections.map((s) => ({ key: s.key, count: s.count, label: s.label })),
      wouldSendTo: recipients.map((r) => ({ name: r.name, phone: mask(r.phone) })),
    });
  }

  // One failed number must not cost the other admins their digest, so each send
  // is settled on its own and reported rather than thrown.
  const results = await Promise.allSettled(
    recipients.map(async (r) => {
      const phone = normPhone(r.phone || "");
      if (phone.length !== 10) throw new Error(`no usable number for ${r.name}`);
      await sendSms({ to: `+1${phone}`, body });
      return r.name;
    }),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => String(r.reason?.message || r.reason));
  if (failed.length) console.error("Digest send failures:", failed);

  return json({ sent, failed, count: attentionCount(sections), body });
}

/** Last four only: this endpoint's output ends up in scheduler logs. */
function mask(phone) {
  const digits = normPhone(phone || "");
  return digits.length === 10 ? `***-***-${digits.slice(-4)}` : "(none)";
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}
