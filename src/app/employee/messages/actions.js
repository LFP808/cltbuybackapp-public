"use server";

import { revalidatePath } from "next/cache";
import { markConversationRead } from "@/lib/repositories/messages";
import { saveContactNotes, saveContactName } from "@/lib/repositories/contact-notes";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canContactCustomers } from "@/domain/access";
import { sendAndLog, userFacingSendError } from "@/lib/messaging";
import { saveImageAndGetUrl, MmsBucketMissingError } from "@/lib/storage";
import { normPhone } from "@/domain/format";

/**
 * Send a text (optionally with an image) to a customer from the inbox, then
 * record it. Not tied to a specific shipment — the inbox is organized by
 * person, not order.
 *
 * @param {string} phone
 * @param {string} text
 * @param {{ base64: string, mimeType: string } | null} [image]
 */
export async function sendMessageAction(phone, text, image) {
  const staff = await requireStaff();
  // The inbox belongs to the office roles. Order-scoped sends come from
  // the order, where the check is scoped to that customer and that day.
  if (!canContactCustomers(staff.role)) {
    return fail("You can only message customers from their order.");
  }

  const to = normPhone(phone);
  if (to.length !== 10) return fail("Invalid phone number.");
  if (!text?.trim() && !image) return fail("Nothing to send.");

  // Host the image in test mode too. Skipping it made a test MMS send as a
  // bare text with the picture silently dropped, so the one thing you were
  // trying to verify was the one thing that didn't happen.
  let mediaUrl = null;
  if (image) {
    try {
      mediaUrl = await saveImageAndGetUrl(image.base64, image.mimeType);
    } catch (err) {
      // Always in the log, whatever the composer shows: the line below is for
      // the person who picked the photo, this one is for whoever set up the
      // project.
      console.error("MMS upload failed:", err?.message || err);
      // A missing bucket is the project's fault, not the photo's. Folding it
      // into "try a smaller photo" had people resizing pictures for a setup
      // bug, so that one is passed through in its own words.
      if (err instanceof MmsBucketMissingError) return fail(err.message);
      // A photo too big for the bucket, or an unsupported type. The person
      // picked it deliberately, so say so instead of showing a generic error.
      return fail("That image couldn't be attached. Try a smaller photo.");
    }
  }

  try {
    await sendAndLog({
      phone: to,
      body: text || "",
      mediaUrl,
      auto: false,
      sentBy: staff.name,
      sentByRole: staff.role,
    });
  } catch (err) {
    const message = userFacingSendError(err);
    if (!message) throw err;
    return fail(message);
  }

  revalidatePath("/employee/messages");
}

/** Mark a customer's inbound messages as read (called when a thread is opened). */
export async function markReadAction(phone) {
  await requireStaff();
  await markConversationRead(phone);
  revalidatePath("/employee/messages");
  revalidatePath("/employee", "layout");
}

/**
 * Save a contact's notes + tags.
 *
 * Gated on canContactCustomers like its siblings: notes are written by whoever
 * runs the conversation, so the note gate matches the composer's.
 */
export async function saveContactNotesAction(phone, data) {
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) {
    return fail("You can't edit customer records.");
  }

  await saveContactNotes(phone, {
    notes: data?.notes ?? "",
    tags: data?.tags ?? [],
  });
  revalidatePath("/employee/messages");
}

/**
 * Correct a contact's display name.
 *
 * Stored as an override on contact_notes, so past orders keep the name they
 * were taken under — an order is a record of what was agreed, not a place to
 * fix a spelling. Sending an empty name clears the override and restores the
 * derived one.
 */
export async function saveContactNameAction(phone, name) {
  // Auth before validation, matching its siblings — an unauthenticated caller
  // should learn nothing about what the endpoint accepts.
  const staff = await requireStaff();
  if (!canContactCustomers(staff.role)) {
    return fail("You can't edit customer records.");
  }

  const to = normPhone(phone);
  if (to.length !== 10) return fail("Invalid phone number.");

  const clean = String(name || "").trim();
  if (clean.length > 80) return fail("That name is too long.");

  await saveContactName(to, clean);
  revalidatePath("/employee/messages");
  revalidatePath("/employee/customers");
  revalidatePath(`/employee/customers/${to}`);
}
