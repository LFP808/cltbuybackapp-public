"use server";

import { revalidatePath } from "next/cache";
import { createManualCustomer } from "@/lib/repositories/manual-customers";
import { deleteContactEverywhere } from "@/lib/repositories/customers";
import { listOrdersByPhone } from "@/lib/repositories/orders";
import { saveContactNotes, saveContactProfile } from "@/lib/repositories/contact-notes";
import { PAYMENT_METHODS } from "@/domain/constants";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canContactCustomers } from "@/domain/access";
import { normPhone } from "@/domain/format";

/** Add a customer by hand from the directory. */
export async function createCustomerAction(input) {
  // Auth before validation, so an unauthenticated caller learns nothing about
  // what the endpoint accepts.
  const staff = (await requireStaff()).name;

  if (!input?.name?.trim()) return fail("Name is required.");
  if (normPhone(input.phone).length !== 10) return fail("A valid 10-digit phone is required.");

  await createManualCustomer({ ...input, createdBy: staff });
  revalidatePath("/employee/customers");
}

/**
 * Save a customer's notes + tags (shared with the messages inbox).
 *
 * Same gate as the inbox copy in messages/actions.js — one write, reached from
 * two screens, so the permission has to match on both.
 */
export async function saveCustomerNotesAction(phone, data) {
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) {
    return fail("You can't edit customer records.");
  }

  await saveContactNotes(phone, { notes: data?.notes ?? "", tags: data?.tags ?? [] });
  revalidatePath("/employee/customers");
  revalidatePath(`/employee/customers/${normPhone(phone)}`);
}

/**
 * Save a customer's lead source and payment preference (shared by the
 * customer page and the inbox panel — one write, two screens, same gate as
 * the notes above).
 */
export async function saveContactProfileAction(phone, data) {
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) {
    return fail("You can't edit customer records.");
  }
  if (normPhone(phone).length !== 10) return fail("Customer not found.");

  const method = String(data?.preferredPaymentMethod || "").trim();
  if (method && !PAYMENT_METHODS.includes(method)) {
    return fail("Pick one of the payout methods.");
  }

  try {
    await saveContactProfile(phone, {
      leadSource: data?.leadSource,
      preferredPaymentMethod: method,
      paymentHandle: data?.paymentHandle,
    });
  } catch (err) {
    // PGRST204 is PostgREST for "no such column": migration 0029 hasn't been
    // run. Named out loud rather than thrown — a thrown action loses its
    // message in production (see app/employee/actions.js), which is exactly
    // how a missing migration turns into a mystery.
    if (err?.code === "PGRST204") {
      return fail("Run supabase/migrations/0029_contact_profile.sql first - this needs it.");
    }
    throw err;
  }

  revalidatePath("/employee/customers");
  revalidatePath(`/employee/customers/${normPhone(phone)}`);
  revalidatePath("/employee/messages");
}

/**
 * Delete a contact - everywhere, or not at all.
 *
 * ADMIN ONLY, and money history blocks it: an order that reached received or
 * paid, or was checked in, feeds the P/L and the cash flow - deleting it
 * would quietly rewrite both. Those contacts keep their records; the answer
 * for a real person who wants gone is opt-out, not erasure of the books.
 *
 * What this is FOR: test contacts, spam callers, wrong numbers - the rows
 * that make the directory lie about how many customers exist.
 */
export async function deleteContactAction(phone) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return fail("Only an admin can delete a contact.");

  const digits = normPhone(phone);
  if (digits.length !== 10) return fail("That isn't a contact phone number.");

  const orders = await listOrdersByPhone(digits);
  const moneyed = orders.filter(
    (o) => o.status === "received" || o.status === "paid" || o.checkedInAt,
  );
  if (moneyed.length) {
    return fail(
      `This contact has ${moneyed.length} order(s) with money history - those records stay. If they asked to be left alone, use the opt-out instead.`,
    );
  }
  const counts = await deleteContactEverywhere(
    digits,
    orders.map((o) => o.id),
  );
  console.warn(`Contact ${digits} deleted by ${staff.name}:`, JSON.stringify(counts));

  revalidatePath("/employee/customers");
  revalidatePath("/employee");
  return { ok: true, counts };
}
