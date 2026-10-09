import { findCallBySid, claimMissedText } from "@/lib/repositories/calls";
import { sendAndLog } from "@/lib/messaging";
import { TEMPLATES } from "@/domain/messages";

/**
 * Text a caller nobody spoke to — once, ever, per call.
 *
 * Two doors lead here: the voicemail fallback (the phones rang and nobody
 * picked up) and "message" mode on /api/voice/incoming (the phones never rang
 * at all). Same text either way, which is why it lives here and not in a
 * route: "Texting is fastest - tell us what you're selling" is the answer to
 * both.
 *
 * The send is claimed in the database first, so a retried webhook cannot text
 * the same person twice.
 *
 * Failures are swallowed: this runs inside a live phone call, and a texting
 * problem must never stop the caller hearing what comes next.
 *
 * @param {string} callSid
 * @param {string} phone normalized 10 digits; anything else is skipped
 */
export async function textMissedCaller(callSid, phone) {
  if (phone.length !== 10) return;

  try {
    const call = await findCallBySid(callSid);
    // Outbound calls end up at the voicemail fallback too when WE ring out;
    // texting ourselves an apology for our own unanswered call would be
    // nonsense.
    if (call?.direction === "outbound") return;

    // Compare-and-swap: the loser of a retry race sends nothing.
    const claimed = await claimMissedText(callSid);
    if (!claimed) return;

    await sendAndLog({
      phone,
      body: TEMPLATES.missed_call(),
      auto: true,
      system: true,
      sentBy: "Auto",
    });
  } catch (err) {
    // Includes the opted-out case: someone who texted STOP still hears the
    // message (or reaches the recorder), they just don't get the text.
    console.error("Missed-call text failed:", err?.message || err);
  }
}
