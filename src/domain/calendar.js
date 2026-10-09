/**
 * Grouping pickups into a day-by-day run sheet.
 *
 * Pure date bucketing — no React, no I/O — so the same shape drives the driver
 * view, any future dispatch screen, and tests.
 *
 * `pickupDate` is stored as a plain YYYY-MM-DD string, not a timestamp: a
 * pickup at 2pm is 2pm where the van is, regardless of server timezone. So all
 * comparison here is done on local calendar days, never on UTC instants — see
 * domain/dates.js, which owns those primitives.
 */
import { parseLocalDate, startOfDay, byTime } from "./dates";

/** Whole days from today to `date` — negative is the past. */
export function daysFromToday(date, now = Date.now()) {
  const a = startOfDay(now).getTime();
  const b = startOfDay(date).getTime();
  return Math.round((b - a) / 86400000);
}

/** "Today" / "Tomorrow" / "Mon, Aug 3" — the label a driver reads. */
export function dayLabel(date, now = Date.now()) {
  const delta = daysFromToday(date, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Bucket pickups into ordered day groups.
 *
 * Overdue comes first and stays separate rather than being folded into its
 * original date: a pickup that didn't happen is the thing most needing action,
 * and burying it under last Tuesday is how it gets forgotten. Undated pickups
 * land in their own group instead of being dropped.
 *
 * @param {import('./types').Shipment[]} pickups
 * @returns {{key: string, label: string, overdue: boolean, items: any[]}[]}
 */
export function groupPickupsByDay(pickups, now = Date.now()) {
  const overdue = [];
  const undated = [];
  /** @type {Map<string, {key: string, label: string, overdue: boolean, items: any[]}>} */
  const byDay = new Map();

  for (const p of pickups) {
    const date = parseLocalDate(p.pickupDate);

    if (!date) {
      undated.push(p);
      continue;
    }
    // Only an unfinished pickup can be overdue; a completed one belongs on the
    // day it actually happened.
    if (daysFromToday(date, now) < 0 && p.status === "awaiting") {
      overdue.push(p);
      continue;
    }

    const key = p.pickupDate;
    if (!byDay.has(key)) {
      byDay.set(key, { key, label: dayLabel(date, now), overdue: false, items: [] });
    }
    byDay.get(key).items.push(p);
  }

  const groups = [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key));

  if (overdue.length) {
    groups.unshift({ key: "overdue", label: "Overdue", overdue: true, items: overdue });
  }
  if (undated.length) {
    groups.push({ key: "unscheduled", label: "No date set", overdue: false, items: undated });
  }

  for (const g of groups) {
    g.items.sort((a, b) => byTime(a.pickupTime, b.pickupTime));
  }
  return groups;
}
