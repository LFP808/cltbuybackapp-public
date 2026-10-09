/**
 * What the phone says: the three ways an incoming call can be handled, and
 * every word a caller hears in each.
 *
 * THE DEFAULT IS "MESSAGE": nothing rings. "I don't even wanna answer the
 * phone" (Jaime, 2026-10-04) - the caller hears one sentence telling them to
 * text, gets the missed-call text to reply to, and the call ends. Texting is
 * the channel this business answers well; a ringing phone is not.
 *
 * The other two stay selectable on /settings because the ringing machinery
 * (softphone, forwarding cell, recording, voicemail) all still works:
 *
 *   "menu"  "This is CLT Buyback. To sell a device, press 1..." It sits IN
 *           FRONT of the ring-everyone step: with two people answering there
 *           is nobody to route between, so every "ring" option reaches the
 *           same phones. What the key press buys is the REASON, stored on
 *           the call (`menu_choice`). Nobody is dead-ended - silence, a wrong
 *           key, a rotary phone all ring through.
 *   "ring"  straight to the phones, as it was before any of this.
 *
 * Pure: the words and the tables live here, the TwiML lives in
 * app/api/voice/{incoming,menu}. Spoken copy is written for a
 * text-to-speech voice - short sentences, "8 AM" not "08:00".
 */

/** How an incoming call is handled. Order is the order /settings offers. */
export const CALL_MODES = [
  {
    key: "message",
    label: "Don't ring - play a message and text them",
    hint: "The caller hears the message below, gets the missed-call text to reply to, and the call ends. No phone rings.",
  },
  {
    key: "menu",
    label: "Play the menu, then ring",
    hint: "The caller picks a reason, then every phone rings. Unanswered calls go to voicemail.",
  },
  {
    key: "ring",
    label: "Ring straight through",
    hint: "Every phone rings at once. Unanswered calls go to voicemail.",
  },
];

export const DEFAULT_CALL_MODE = "message";

/**
 * What a caller hears in "message" mode until an admin writes their own.
 * "At this number" is deliberate: the line they rang is the line that takes
 * texts, and a caller told only to "text us" has to guess that.
 */
export const DEFAULT_BUSY_MESSAGE =
  "All of our employees are busy at the moment. Text us at this number for the fastest reply.";

/** Long enough for two sentences, short enough that nobody hangs up on it. */
export const BUSY_MESSAGE_MAX = 300;

/**
 * What `menu_choice` holds on a call that got the busy message. The menu
 * columns double as "what the auto-answer did with this call", so the log can
 * say so (domain/calls.js#toldToText) without a third column.
 */
export const TOLD_TO_TEXT = "told_to_text";

/**
 * The stored `incoming_calls` setting as something safe to act on. Each half
 * falls back on its own: an unknown mode means the default, and a blank
 * message means the default sentence - a caller must never be answered with
 * silence because a settings row was saved empty.
 *
 * @returns {{mode: "message"|"menu"|"ring", message: string}}
 */
export function normalizeIncomingCalls(raw) {
  const mode = CALL_MODES.some((m) => m.key === raw?.mode) ? raw.mode : DEFAULT_CALL_MODE;
  const message = typeof raw?.message === "string" ? raw.message.trim() : "";
  return { mode, message: message || DEFAULT_BUSY_MESSAGE };
}

/**
 * Check what the settings form sent. Returns `{ error }` naming the problem,
 * or `{ value }` ready to store. Whitespace is collapsed because the text is
 * read aloud: a line break is not a pause, it is nothing.
 *
 * @returns {{ error: string } | { value: {mode: string, message: string} }}
 */
export function validateIncomingCalls(input) {
  if (!CALL_MODES.some((m) => m.key === input?.mode)) {
    return { error: "Pick how incoming calls are handled." };
  }
  const message = String(input?.message ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) return { error: "The message can't be blank - callers would hear silence." };
  if (message.length > BUSY_MESSAGE_MAX) {
    return {
      error: `Keep the message under ${BUSY_MESSAGE_MAX} characters - it is ${message.length}.`,
    };
  }
  return { value: { mode: input.mode, message } };
}

/**
 * One row per key. `does` is "ring" (put the caller through) or "info" (the
 * menu answers by itself). `label` is what the call log shows staff.
 *
 * To change what callers hear, edit `say` here - /settings previews exactly
 * these lines. Keys ("sell", "info"...) are stored on call rows, so rename a
 * `say` freely but leave a `key` alone once calls carry it.
 */
export const PHONE_MENU = [
  {
    digit: "1",
    key: "sell",
    say: "To sell a device, press 1.",
    does: "ring",
    label: "Sell a device",
  },
  {
    digit: "2",
    key: "appointment",
    say: "If you already have an appointment, press 2.",
    does: "ring",
    label: "Has an appointment",
  },
  {
    digit: "3",
    key: "info",
    say: "For our address and hours, press 3.",
    does: "info",
    label: "Address & hours",
  },
  {
    digit: "0",
    key: "other",
    say: "For anything else, press 0.",
    does: "ring",
    label: "Something else",
  },
];

/**
 * What `menu_choice` holds when a call rang through WITHOUT a usable key
 * press (silence, "*", a digit that isn't on the menu). A value rather than
 * null on purpose: null means "still in the menu, or hung up there", and the
 * call log has to tell those two apart (domain/calls.js#leftAtMenu).
 */
export const NO_CHOICE = "none";

/** The option a key press selects, or null. */
export function menuOption(digit) {
  return PHONE_MENU.find((o) => o.digit === String(digit ?? "").trim()) ?? null;
}

/** The option a stored `menu_choice` names, or null. */
export function menuOptionByKey(key) {
  return PHONE_MENU.find((o) => o.key === key) ?? null;
}

/**
 * The reason to show beside a call that was put through - "Sell a device" -
 * or "" when there is nothing worth showing (no menu, no key pressed, or an
 * info-only call, which the outcome already names).
 */
export function menuChoiceLabel(key) {
  const option = menuOptionByKey(key);
  return option?.does === "ring" ? option.label : "";
}

/** The whole greeting, as one string for <Say>. */
export function menuPrompt(businessName) {
  return [`This is ${businessName}.`, ...PHONE_MENU.map((o) => o.say)].join(" ");
}

/** Offered after the address and hours have been read out. */
export function afterInfoPrompt() {
  const info = PHONE_MENU.find((o) => o.does === "info");
  const person = PHONE_MENU.find((o) => o.key === "other");
  return `To hear that again, press ${info.digit}. To speak with someone, press ${person.digit}.`;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** 510 -> "8:30 AM", 720 -> "noon". Minutes since midnight, said aloud. */
function spokenTime(min) {
  if (min === 12 * 60) return "noon";
  if (min === 0 || min === 24 * 60) return "midnight";
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

const spokenWindow = (w) => `${spokenTime(w.startMin)} to ${spokenTime(w.endMin)}`;

/** "Monday", "Saturday and Sunday", "Monday through Friday", "every day". */
function spokenDays(from, to) {
  if (from === to) return DAY_NAMES[from];
  if (to - from === 6) return "every day";
  if (to - from === 1) return `${DAY_NAMES[from]} and ${DAY_NAMES[to]}`;
  return `${DAY_NAMES[from]} through ${DAY_NAMES[to]}`;
}

/**
 * The booking schedule from /settings, said aloud: consecutive days that
 * share hours collapse into one phrase, so the usual case is one short
 * sentence ("Our hours are every day, 8 AM to 8 PM.") instead of seven.
 *
 * A special date covering TODAY leads, because "open every day" is the wrong
 * thing to tell someone calling on the holiday that is closed.
 *
 * @param {ReturnType<import("./booking").normalizeBookingSchedule>} schedule
 * @param {string} today YYYY-MM-DD on the business clock
 */
export function spokenHours(schedule, today) {
  const runs = [];
  (schedule?.week ?? []).forEach((w, i) => {
    const sig = w ? `${w.startMin}-${w.endMin}` : "closed";
    const last = runs[runs.length - 1];
    if (last && last.sig === sig) last.to = i;
    else runs.push({ sig, from: i, to: i, window: w });
  });

  const open = runs
    .filter((r) => r.window)
    .map((r) => `${spokenDays(r.from, r.to)}, ${spokenWindow(r.window)}`);
  const closed = runs.filter((r) => !r.window).map((r) => spokenDays(r.from, r.to));

  const sentences = [];
  if (Object.prototype.hasOwnProperty.call(schedule?.dates ?? {}, today)) {
    const w = schedule.dates[today];
    sentences.push(w ? `Today we're open ${spokenWindow(w)}.` : "We're closed today.");
  }
  if (open.length) {
    sentences.push(`Our ${sentences.length ? "regular " : ""}hours are ${open.join(", and ")}.`);
  }
  if (open.length && closed.length) sentences.push(`We're closed ${closed.join(" and ")}.`);
  return sentences.join(" ");
}

/**
 * Where to come, said aloud. No state and no ZIP: a caller needs the street
 * to type into a map, and a text-to-speech voice reads "28262" as a number
 * in the tens of thousands.
 *
 * @param {{street?: string, street2?: string, city?: string}} address
 */
export function spokenAddress(address = {}) {
  const street = [address.street, address.street2].filter(Boolean).join(", ");
  if (street) return `We're at ${street}${address.city ? `, in ${address.city}` : ""}.`;
  return address.city ? `We're in ${address.city}.` : "";
}

/** Everything the "address and hours" option says, as one string. */
export function infoSpeech({ address, schedule, today }) {
  return [spokenAddress(address), spokenHours(schedule, today)].filter(Boolean).join(" ");
}
