"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canContactCustomers } from "@/domain/access";
import { isMessagingEnabled, MESSAGING_OFF_REASON } from "@/domain/mode";
import { setCallHandled, upsertCall } from "@/lib/repositories/calls";
import { createManualCustomer } from "@/lib/repositories/manual-customers";
import { placeCall, isSmsTestMode } from "@/lib/twilio/client";
import { voiceConfig } from "@/lib/twilio/voice";
import { normPhone } from "@/domain/format";

/**
 * Server actions for the call log. Same contract as every action file:
 * EXPECTED FAILURES ARE RETURNED via fail(); throwing is for genuine faults.
 *
 * Both gate on canContactCustomers — the permission that already decides who
 * runs the inbox and the phone, so the callback queue answers to the same
 * rule. Middleware keeps everyone else off /calls anyway; this is the same
 * rule enforced at the door as well as the gate.
 */

/**
 * Ring the owner's cell, then bridge them to a customer — the call-through.
 *
 * The browser softphone needs Twilio API keys and a TwiML app that were never
 * provisioned, so until they are there is no way to call anybody back. This
 * path needs only the credentials texting already uses: Twilio rings the
 * owner's cell (TWILIO_FORWARD_TO_NUMBER — the same cell inbound calls
 * forward to) from the business number, and when he answers, /api/voice/bridge
 * dials the customer showing the business caller ID.
 *
 * ADMIN ONLY, tighter than canContactCustomers on purpose (Jaime,
 * 2026-08-10): the first leg rings HIS personal phone, so nobody else gets a
 * button that makes it ring.
 */
export async function callCustomerAction({ phone }) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can place calls.");

  const digits = normPhone(phone || "");
  if (digits.length !== 10) return fail("There's no usable phone number to call.");

  if (!isMessagingEnabled()) return fail(MESSAGING_OFF_REASON);
  // The SMS test-mode flag doubles as "don't touch Twilio from this machine".
  // A test-mode SEND can be logged instead of sent; a test-mode CALL has no
  // pretend version worth having, so it simply refuses.
  if (isSmsTestMode()) return fail("Test mode is on - calls are not placed from here.");

  const { businessNumber, forwardTo } = voiceConfig();
  if (!businessNumber || !forwardTo) {
    return fail("Set TWILIO_FORWARD_TO_NUMBER to the cell that should ring first.");
  }

  // The bridge URL must be absolute and reachable by Twilio. In production the
  // request host is exactly that; TWILIO_VOICE_BASE_URL wins when set (same
  // rule as baseUrl() in lib/twilio/voice.js, which needs a Request this
  // action doesn't have).
  const h = await headers();
  const base = (
    process.env.TWILIO_VOICE_BASE_URL ||
    `${h.get("x-forwarded-proto") || "https"}://${h.get("x-forwarded-host") || h.get("host")}`
  ).replace(/\/$/, "");

  // DIGITS ONLY in this query, and that is load-bearing: Twilio signs the URL
  // exactly as given here, but Vercel's routing layer normalises percent-
  // encoding in incoming query strings, so anything that NEEDS encoding (the
  // customer's name used to ride here as name=Michael%20Grosso) arrives
  // re-serialised, the reconstructed signature no longer matches, and the
  // caller hears "an application error has occurred" (2026-08-11). The bridge
  // looks the name up by phone instead.
  const query = `to=${digits}`;
  let sid;
  try {
    ({ sid } = await placeCall({
      to: forwardTo,
      url: `${base}/api/voice/bridge?${query}`,
      statusCallback: `${base}/api/voice/status`,
      // Under the ~25s a carrier gives a cell before voicemail answers — a
      // mailbox that picks up would get the customer dialled into it.
      timeout: 20,
    }));
  } catch (err) {
    return fail(err?.message || "The call could not be placed.");
  }

  // The row exists from the first ring, keyed on the leg the status callbacks
  // will report against, so the calls page shows it live like every other
  // call. answered_by is known up front - the whole point of this path is that
  // only the admin's own phone rings.
  try {
    await upsertCall(sid, {
      direction: "outbound",
      from_number: businessNumber,
      to_number: `+1${digits}`,
      phone: digits,
      status: "ringing",
      answered_by: staff.id,
      answered_name: staff.name,
    });
  } catch (err) {
    // The call is already ringing; a failed log line must not report failure.
    console.error("Call-through log failed:", err?.message || err);
  }

  revalidatePath("/employee/calls");
  return undefined;
}

/** Mark a missed call followed up (or reopen one closed by mistake). */
export async function setCallHandledAction(id, handled) {
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) return fail("You can't update calls.");
  if (!id) return fail("Call not found.");

  await setCallHandled(id, { handled: Boolean(handled), staffName: staff.name });
  revalidatePath("/employee/calls");
}

/**
 * Turn an unknown caller into a customer record.
 *
 * The missing half of the lead path: a number that has only ever called us
 * exists nowhere — not in Customers, not in the inbox — so there was no way to
 * write down who they are or to text them back. This creates the record the
 * rest of the app is keyed on, and marks the call handled in the same breath,
 * because adding them IS the follow-up.
 */
export async function addCallerAsCustomerAction({ callId, phone, name }) {
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) return fail("You can't add customers.");

  const digits = normPhone(phone || "");
  if (digits.length !== 10) return fail("That call has no usable phone number.");
  const trimmed = String(name || "").trim();
  if (!trimmed) return fail("Give them a name — even just what they said on the phone.");

  await createManualCustomer({ phone: digits, name: trimmed, createdBy: staff.name });
  if (callId) {
    await setCallHandled(callId, { handled: true, staffName: staff.name }).catch(() => {});
  }

  revalidatePath("/employee/calls");
  revalidatePath("/employee/customers");
  revalidatePath(`/employee/customers/${digits}`);
}
