/**
 * Pure formatting + small id helpers. No React, no DOM — safe to use on the
 * server (API routes, repositories) and the client alike.
 */

/** Short random id for client-side draft rows before a DB id exists. */
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Reduce any phone input to its last 10 digits. */
export function normPhone(p) {
  return (p || "").replace(/\D/g, "").slice(-10);
}

/** Format a phone number as (704) 555-0142; returns input unchanged if not 10 digits. */
export function fmtPhone(p) {
  const d = normPhone(p);
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** First token of a name, falling back to a friendly "there". */
export function firstNameOf(name) {
  return (name || "").trim().split(/\s+/)[0] || "there";
}

/**
 * Appointment time for humans: "14:00" -> "2:00 PM".
 *
 * Stored times are the LOCAL wall-clock value the form's time input produced
 * (24-hour HH:MM), which nobody wants to read off a screen mid-conversation.
 * Times are free text though ("2pm" typed by hand survives), so anything
 * that isn't HH:MM passes through untouched: showing "2pm" beats showing
 * nothing. One definition here for every surface — the calendar and the
 * customer texts must call 2 o'clock the same thing.
 */
export function fmtApptTime(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return value || "";
  const hour = Number(m[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m[2]} ${suffix}`;
}

/** Format a number as USD. */
export function currency(n) {
  const value = Number(n) || 0;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Sum the line-item value of an order. */
export function itemsTotal(items = []) {
  return items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
}
