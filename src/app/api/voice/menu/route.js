import { baseUrl, webhookUrl, twiml, xml } from "@/lib/twilio/voice";
import { readTwilioWebhook } from "@/lib/twilio/webhook";
import { ringTargets, ringTwiml, NOBODY_TO_RING } from "@/lib/twilio/ring";
import { upsertCall } from "@/lib/repositories/calls";
import { getBookingSchedule } from "@/lib/repositories/settings";
import { officeAddress } from "@/lib/business";
import { menuOption, afterInfoPrompt, infoSpeech, NO_CHOICE } from "@/domain/phone-menu";
import { dayKey } from "@/domain/dates";

/**
 * The phone menu's answer: what a key press does.
 *
 * Twilio POSTs here twice over: as the <Gather action> when the caller
 * presses a key (`Digits` set), and as the <Redirect> that follows the
 * greeting when they press nothing (`Digits` absent). The table of keys is
 * domain/phone-menu.js; this route only turns a row into TwiML.
 *
 * ANYTHING THAT ISN'T AN "INFO" KEY RINGS THROUGH - a ring option, silence,
 * "*", a digit that isn't on the menu. A person sorts out a wrong key in
 * five seconds; a menu that says "invalid selection" and loops loses the
 * caller. The choice is written to the call row first, so the phones that
 * ring already show why.
 *
 * The info option reads the address and hours from /settings (system reads:
 * no session here) and then offers a person. Silence after THAT is a caller
 * who got what they rang for, so it ends the call instead of ringing staff.
 */
export async function POST(request) {
  const { params, forbidden } = await readTwilioWebhook(
    request,
    webhookUrl(request, "/api/voice/menu"),
  );
  if (forbidden) return forbidden;

  const option = menuOption(params.Digits);

  // Recorded even for "no usable key": null has to keep meaning "never got
  // past the menu", which is how a hang-up at the greeting stays a missed
  // call instead of being filed as answered (domain/calls.js#leftAtMenu).
  try {
    await upsertCall(params.CallSid, { menu_choice: option?.key ?? NO_CHOICE });
  } catch (err) {
    // Bookkeeping only - never a reason to hold up the caller.
    console.error("Menu choice write failed (migration 0009 run?):", err?.message || err);
  }

  if (option?.does === "info") {
    const [office, schedule] = await Promise.all([
      officeAddress({ system: true }),
      getBookingSchedule({ system: true }),
    ]);
    const speech = infoSpeech({ address: office, schedule, today: dayKey(new Date()) });
    const menu = xml(`${baseUrl(request)}/api/voice/menu`);
    return twiml(
      // One <Gather> around both, so "0" pressed halfway through the address
      // goes to a person without waiting for the rest of it.
      `<Gather numDigits="1" timeout="6" action="${menu}" method="POST">` +
        `<Say>${xml(speech)}</Say>` +
        `<Say>${xml(afterInfoPrompt())}</Say>` +
        `</Gather>` +
        `<Say>${xml(`Thanks for calling ${office.name}. Goodbye.`)}</Say><Hangup/>`,
    );
  }

  const targets = await ringTargets();
  if (!targets.any) return twiml(NOBODY_TO_RING);
  return twiml(ringTwiml(request, targets));
}
