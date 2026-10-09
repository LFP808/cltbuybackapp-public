/**
 * Twilio Voice Intelligence — turning a finished recording into a transcript.
 *
 * Post-call rather than live. Twilio can stream a transcript during the call
 * (<Start><Transcription>), but that needs a websocket sink held open for the
 * duration and only pays off if someone is reading along in real time. What an
 * assistant actually needs is the transcript sitting on the call afterwards,
 * so this asks for one when the recording lands and stores it when it's ready.
 *
 * Requires TWILIO_INTELLIGENCE_SERVICE_SID. Without it, transcription is
 * skipped and calls simply carry a recording — the log still works.
 */

const API = "https://intelligence.twilio.com/v2";

function auth() {
  // API key preferred: it can be rotated without changing the account password
  // and is already needed for access tokens. Auth token is the fallback.
  const sid = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID;
  const secret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !secret) return null;
  return `Basic ${Buffer.from(`${sid}:${secret}`).toString("base64")}`;
}

export function isTranscriptionConfigured() {
  return Boolean(process.env.TWILIO_INTELLIGENCE_SERVICE_SID && auth());
}

/**
 * Ask Twilio to transcribe a recording.
 *
 * `channel` names the two sides so the transcript reads as a conversation
 * rather than a wall of text — which is why the recording is made dual-channel
 * in the first place.
 *
 * @param {string} recordingSid
 * @param {string} customerNumber
 * @returns {Promise<string|null>} the transcript sid, or null if not configured
 */
export async function requestTranscript(recordingSid, customerNumber) {
  const header = auth();
  const serviceSid = process.env.TWILIO_INTELLIGENCE_SERVICE_SID;
  if (!header || !serviceSid || !recordingSid) return null;

  const body = new URLSearchParams({
    ServiceSid: serviceSid,
    Channel: JSON.stringify({
      media_properties: { source_sid: recordingSid },
      participants: [
        { channel_participant: 1, role: "Customer", media_participant_id: customerNumber || "" },
        { channel_participant: 2, role: "Agent" },
      ],
    }),
  });

  const res = await fetch(`${API}/Transcripts`, {
    method: "POST",
    headers: { Authorization: header, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Transcript request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()).sid ?? null;
}

/**
 * Fetch a finished transcript and flatten it into readable text.
 *
 * Returned as "Agent: ..." / "Customer: ..." lines rather than structured
 * turns: it is read by a person scanning for what was agreed, and a paragraph
 * of speaker-labelled lines is the form that survives being pasted into a note
 * or searched with ctrl-F.
 *
 * @param {string} transcriptSid
 * @returns {Promise<string>}
 */
export async function fetchTranscriptText(transcriptSid) {
  const header = auth();
  if (!header || !transcriptSid) return "";

  const res = await fetch(`${API}/Transcripts/${transcriptSid}/Sentences?PageSize=1000`, {
    headers: { Authorization: header },
  });
  if (!res.ok) throw new Error(`Transcript fetch failed (${res.status})`);

  const { sentences = [] } = await res.json();
  return sentences
    .map((s) => {
      const who = s.media_channel === 1 ? "Customer" : "Agent";
      return `${who}: ${s.transcript}`;
    })
    .join("\n");
}
