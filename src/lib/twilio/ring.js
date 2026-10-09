import { voiceConfig, baseUrl, xml } from "./voice";
import { listVoiceStaff } from "@/lib/repositories/profiles";

/**
 * Putting a caller through: the one <Dial> every incoming call ends up in,
 * whether it came straight from /api/voice/incoming (phone menu off) or
 * through a key press on /api/voice/menu. One builder so the two cannot
 * drift - the recording, the voicemail fallback and who rings are the same
 * call whichever door it came in by.
 *
 * EVERYTHING RINGS AT ONCE. One <Dial> containing the forwarding cell and a
 * <Client> for each assistant: Twilio rings them in parallel and the first to
 * pick up gets the call, cancelling the others. No queue, no hold music, no
 * ring-then-ring-again delay for the caller - which is the whole argument for
 * simultaneous ringing over a hunt order in a team this size.
 *
 * A <Client> whose browser isn't registered fails its leg immediately and is
 * simply not one of the phones that rang, so nothing has to track who is at
 * their desk. Staff go in the list by ROLE — every active admin and VA.
 *
 * Calls are recorded from the moment someone answers, in dual channel so the
 * caller and the answerer land on separate tracks and a transcript can tell
 * them apart. See voiceConfig().announceRecording for the consent notice.
 */

/** Said when there is no cell and no assistant to ring at all. */
export const NOBODY_TO_RING = `<Say>This number isn't set up to take calls yet. Please send a text message instead.</Say><Hangup/>`;

/**
 * Who would ring right now. Asked BEFORE the menu plays as well as before
 * the dial: reading a caller four options and then telling them the number
 * isn't set up would be worse than saying so straight away.
 *
 * @returns {Promise<{clients: {id: string, name: string}[], forwardTo: string, any: boolean}>}
 */
export async function ringTargets() {
  const { forwardTo } = voiceConfig();
  let clients = [];
  try {
    clients = await listVoiceStaff();
  } catch (err) {
    console.error("Could not list voice staff:", err?.message || err);
  }
  return { clients, forwardTo, any: Boolean(forwardTo) || clients.length > 0 };
}

/**
 * The TwiML that rings everyone, ready for twiml().
 *
 * @param {Request} request
 * @param {Awaited<ReturnType<typeof ringTargets>>} targets
 */
export function ringTwiml(request, { clients, forwardTo }) {
  const { businessNumber, announceRecording, recordingNotice } = voiceConfig();
  const base = baseUrl(request);

  const notice = announceRecording ? `<Say>${xml(recordingNotice)}</Say>` : "";
  const legs = [
    ...clients.map(
      (s) =>
        // statusCallback per leg is how we learn WHICH assistant answered;
        // the call-level callback only knows that someone did.
        `<Client statusCallbackEvent="answered completed" statusCallback="${xml(
          `${base}/api/voice/leg?staff=${encodeURIComponent(s.id)}`,
        )}" method="POST">${xml(s.id)}</Client>`,
    ),
    forwardTo ? `<Number>${xml(forwardTo)}</Number>` : "",
  ].join("");

  // answerOnBridge => the caller hears real ringing rather than silence.
  return (
    notice +
    `<Dial callerId="${xml(businessNumber)}" answerOnBridge="true" timeout="25"` +
    ` record="record-from-answer-dual"` +
    ` recordingStatusCallback="${xml(`${base}/api/voice/recording`)}"` +
    ` recordingStatusCallbackEvent="completed"` +
    ` action="${xml(`${base}/api/voice/voicemail`)}" method="POST">` +
    legs +
    `</Dial>`
  );
}
