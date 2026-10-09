"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { fail } from "@/lib/action-result";
import { canAccess } from "@/domain/access";
import { normPhone } from "@/domain/format";
import { isValidStatus } from "@/domain/device-inquiries";
import {
  updateDeviceInquiry,
  markDeviceInquiryContacted,
} from "@/lib/repositories/device-inquiries";
import { listMessagesByPhone } from "@/lib/repositories/messages";
import { getContactNotes } from "@/lib/repositories/contact-notes";
import { sendMessageAction } from "@/app/employee/messages/actions";

/**
 * Server actions for the leads triage list. Same contract as every action
 * file: EXPECTED FAILURES ARE RETURNED via fail(), not thrown (see
 * lib/action-result.js). Middleware already keeps unauthorized roles off
 * /leads, but an action is a public POST endpoint in its own right, so it
 * re-checks the same ROUTE_ACCESS rule it is reachable from.
 */

export async function updateDeviceInquiryAction({ id, status, notes }) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/leads")) return fail("You can't update leads.");
  if (!id) return fail("Lead not found.");
  if (!isValidStatus(status)) return fail("Pick a valid status.");

  await updateDeviceInquiry({ id, status, notes: String(notes || "").trim() });
  revalidatePath("/employee/leads");
}

/**
 * The SMS thread for a lead's phone, lazy-loaded when its row expands.
 *
 * Messages are keyed purely by phone, same as the main inbox — a lead with
 * no orders/customer history yet still works here, returning whatever prior
 * texts exist (often none). smsOptedOut/statusUnknown are built the exact
 * same way lib/repositories/customers.js builds them for the customer page,
 * so domain/contact-status.js#contactRestriction works unmodified. Does NOT
 * mark anything read — opening a thread is not the same as reading it (see
 * LeadsManager's markRead, which fires on actual interaction).
 */
export async function getLeadThreadAction(phone) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/leads")) return fail("You can't view this lead's messages.");

  const to = normPhone(phone);
  if (to.length !== 10) return fail("Invalid phone number.");

  const [messages, notes] = await Promise.all([
    listMessagesByPhone(to),
    getContactNotes(to).catch(() => null),
  ]);

  return {
    messages,
    smsOptedOut: Boolean(notes?.smsOptedOutAt),
    statusUnknown: notes === null,
  };
}

/**
 * Reply to a lead from /leads. Wraps the existing inbox send path rather
 * than duplicating its opt-out/image-upload logic, then auto-advances the
 * lead to "contacted" on its first reply — but only on a send that actually
 * went through; a failed send must never advance status.
 */
export async function sendLeadReplyAction(inquiryId, phone, text, image) {
  const staff = await requireStaff();
  if (!canAccess(staff.role, "/leads")) return fail("You can't reply to leads.");

  const result = await sendMessageAction(phone, text, image);
  if (result?.error) return result;

  if (inquiryId) {
    await markDeviceInquiryContacted(inquiryId).catch((err) => {
      // Best-effort: the text already went out, so a DB hiccup here must not
      // read to the sender as "your message failed to send."
      console.error("Lead auto-advance to contacted failed:", err?.message || err);
    });
  }
  revalidatePath("/employee/leads");
}
