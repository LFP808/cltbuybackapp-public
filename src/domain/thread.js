/**
 * Pure helpers for rendering a message thread: relative timestamps, date
 * separators, and grouping consecutive messages into visual "runs" (so a
 * burst of texts from the same side shares one tail + timestamp).
 *
 * No React, no I/O — safe to unit test and reuse anywhere.
 */

/** Compact "2m / 3h / 5d / Mar 4" relative timestamp for list previews. */
export function timeAgoShort(at) {
  if (!at) return "";
  const diff = Date.now() - at;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Today" / "Yesterday" / "March 4" (year only when not the current year). */
export function dateLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

/**
 * The visual style of a message: inbound (customer, left), automated (system,
 * right), or manual (staff, right). Runs are grouped by this type.
 */
export function messageType(msg) {
  if (msg.direction === "inbound") return "inbound";
  return msg.auto ? "auto" : "manual";
}

/**
 * Turn a flat message list into renderable rows: date separators plus message
 * rows annotated with their run position and visual type.
 *
 * @param {import('./types').Message[]} messages
 * @returns {Array<{kind:'date',label:string} | {kind:'msg',msg:object,type:'inbound'|'auto'|'manual',isRunStart:boolean,isRunEnd:boolean}>}
 */
export function groupMessages(messages) {
  const sorted = [...messages].sort((a, b) => a.at - b.at);
  const rows = [];
  let lastDateKey = null;
  let lastRun = null;

  sorted.forEach((msg) => {
    const d = new Date(msg.at);
    const dateKey = d.toDateString();
    if (dateKey !== lastDateKey) {
      rows.push({ kind: "date", label: dateLabel(d) });
      lastDateKey = dateKey;
      lastRun = null;
    }
    const type = messageType(msg);
    const run = runKey(msg, type);
    rows.push({ kind: "msg", msg, type, run, isRunStart: run !== lastRun });
    lastRun = run;
  });

  // Second pass: mark the last message of each run (gets the tail + timestamp).
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== "msg") continue;
    const next = rows[i + 1];
    rows[i].isRunEnd = !next || next.kind !== "msg" || next.run !== rows[i].run;
  }
  return rows;
}

/**
 * What makes consecutive bubbles one run.
 *
 * Type alone is not enough. A run start is where attribution is drawn, so
 * grouping only by inbound/auto/manual would put an assistant's reply and a
 * driver's reply in the same run and label both with whoever spoke first —
 * hiding exactly the case worth seeing, which is two of our people answering
 * the same customer.
 */
function runKey(msg, type) {
  return type === "manual" ? `manual:${msg.by || ""}` : type;
}
