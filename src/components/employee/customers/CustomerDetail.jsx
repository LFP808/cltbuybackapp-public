"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Package, MessageSquare, Phone } from "lucide-react";
import { Card, Button, StatusBadge, Mono, SectionLabel } from "@/components/ui";
import { ContactNotesEditor } from "@/components/employee/messages/ContactNotesEditor";
import { ContactFacts } from "@/components/employee/customers/ContactFacts";
import { CallButton } from "@/components/employee/voice/CallButton";
import { CallCustomerButton } from "@/components/employee/voice/CallCustomerButton";
import { CallHistory } from "@/components/employee/calls/CallHistory";
import { ContactRestrictionNotice } from "@/components/employee/ContactRestrictionNotice";
import { contactRestriction } from "@/domain/contact-status";
import { EditableName } from "@/components/employee/customers/EditableName";
import { MessageThread } from "@/components/employee/messages/MessageThread";
import { Composer } from "@/components/employee/messages/Composer";
import { fmtPhone, currency } from "@/domain/format";
import { CustomerDevices } from "@/components/employee/customers/CustomerDevices";
import { KindFlair } from "@/components/employee/customers/KindFlair";
import { saveCustomerNotesAction } from "@/app/employee/customers/actions";
import { runAction } from "@/lib/run-action";
import { sendMessageAction, markReadAction } from "@/app/employee/messages/actions";

/**
 * Full CRM view of one customer: identity, lifetime stats, notes/tags, order
 * history, and a live conversation you can reply in.
 *
 * Layout follows what the page is actually for. Everything describing WHO the
 * customer is — identity, stats, notes, past orders — is reference material and
 * collapses into a fixed-width sidebar. The conversation is the thing staff
 * work in, so it takes the flexible column and runs the full height with the
 * composer pinned to the bottom, the way any messaging tool is shaped. The
 * earlier split gave the tallest content the narrower column, which is why the
 * thread crammed while the order list left a large empty gap.
 */
export function CustomerDetail({ customer, lots = [], messagingOff = false }) {
  const router = useRouter();
  const c = customer;
  // What the composer consults. The customer carries their own opt-out state;
  // the deployment-wide switch is layered on here so both the notice and the
  // input box read one object.
  const contact = { ...c, messagingOff };

  /** Returns the outcome so ContactNotesEditor can report a refusal. */
  async function saveNotes(data) {
    const { ok, error } = await runAction(() => saveCustomerNotesAction(c.phone, data));
    if (!ok) return { error };
    router.refresh();
    return undefined;
  }

  const hasUnread = c.messages.some((m) => m.direction === "inbound" && !m.readAt);
  const markedRef = useRef(false);

  /**
   * Clear the unread badge once staff actually engage with the thread.
   *
   * Deliberately NOT on mount: this page is a common waypoint on the way to
   * creating an order, and silently marking a customer's reply read because
   * someone passed through would make the nav badge untrustworthy. It fires on
   * real input — a click, a keypress, or focus landing inside the pane — and on
   * sending, which is unambiguous proof the message was read.
   *
   * Scroll is excluded on purpose: MessageThread auto-scrolls to the bottom on
   * mount, so a scroll handler would fire without anyone touching anything.
   */
  const markRead = useCallback(() => {
    if (markedRef.current || !hasUnread) return;
    markedRef.current = true; // once per mount, before the await
    // Best-effort: an expired session here must not become an unhandled rejection.
    markReadAction(c.phone)
      .then(() => router.refresh())
      .catch(() => {});
  }, [hasUnread, c.phone, router]);

  /** Send from this page. Keyed by phone, not shipment — same path as the inbox. */
  async function sendMessage(text, image) {
    const { ok, error } = await runAction(() => sendMessageAction(c.phone, text, image));
    // Rethrown client-side so the Composer surfaces it and keeps the text; a
    // returned refusal used to clear the box with nothing shown.
    if (!ok) throw new Error(error);
    markRead();
    router.refresh();
  }

  return (
    /* Full width, and on desktop exactly one screen tall: the header, the page
       padding and the back link come off the top, and the two columns scroll
       inside themselves. This is a workspace someone sits in all day, not a
       document - a page that scrolls as a whole means losing sight of the
       composer to read an order, and losing the thread to reach a note. */
    <div className="w-full lg:flex lg:h-[calc(100vh-8.5rem)] lg:flex-col">
      <Link
        href="/customers"
        className="mb-3 inline-flex flex-shrink-0 items-center gap-1 self-start text-[13px] font-bold text-accent"
      >
        <ChevronLeft size={16} /> All customers
      </Link>

      {/* min-w-0 on both tracks: grid items otherwise refuse to shrink below
          their widest unbreakable content, which is how one long URL in the
          conversation used to drag the entire page off-screen. */}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-stretch">
        {/* --- Sidebar: who this customer is ------------------------------- */}
        <div className="min-w-0 space-y-4 lg:overflow-y-auto lg:pb-1 lg:pr-1">
          <Card>
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-accent font-serif text-lg text-white">
                {c.initial}
              </div>
              <div className="min-w-0 flex-1">
                <EditableName
                  phone={c.phone}
                  name={c.name}
                  className="font-serif text-lg text-ink"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted">{fmtPhone(c.phone)}</span>
                  <KindFlair kind={c.kind} title={c.kindDetail} />
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                as={Link}
                href={`/new?phone=${c.phone}&name=${encodeURIComponent(c.name)}`}
                size="sm"
                className="flex-1 justify-center"
              >
                <Plus size={15} /> New order
              </Button>
              {/* Renders only when this browser's phone is registered. */}
              <CallButton phone={c.phone} variant="ghost" size="sm" />
              {/* The admin's call-through — rings his cell, then the customer. */}
              <CallCustomerButton phone={c.phone} name={c.name} variant="ghost" size="sm" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-line pt-4">
              <Stat label="Orders" value={c.shipmentCount} />
              <Stat label="Total paid" value={currency(c.totalPaid)} />
              <Stat label="First seen" value={new Date(c.firstSeen).toLocaleDateString()} />
              <Stat label="Last active" value={new Date(c.lastActivity).toLocaleDateString()} />
            </div>

            {/* Calls sit with the identity for the same reason notes do: they
                are what we know about this person, not a separate subject. */}
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                <Phone size={12} /> Calls
              </h3>
              <CallHistory calls={c.calls ?? []} />
            </div>

            {/* Standing facts about the person: where they came from, how
                they like their payout. Same card as the identity they
                describe. */}
            <div className="mt-4 border-t border-line pt-4">
              <ContactFacts
                phone={c.phone}
                leadSource={c.leadSource}
                preferredPaymentMethod={c.preferredPaymentMethod}
                paymentHandle={c.paymentHandle}
              />
            </div>

            {/* Notes belong to the person, not to a card of their own. Read-only
                until the pencil is pressed - see ContactNotesEditor. */}
            <div className="mt-4 border-t border-line pt-4">
              <ContactNotesEditor notes={c.notes} tags={c.tags} onSave={saveNotes} />
            </div>
          </Card>

          <div className="min-w-0">
            <SectionLabel icon={Package}>Order history</SectionLabel>
            {c.shipments.length === 0 ? (
              <Card className="text-[13px] italic text-muted">No orders yet.</Card>
            ) : (
              <div className="flex flex-col gap-2">
                {c.shipments.map((s) => {
                  // A booked meetup reads as its date; a walk-in as itself.
                  const label = s.pickupDate || "Walk-in";
                  return (
                    <Link key={s.id} href={`/orders/${s.id}`} className="block min-w-0">
                      <Card className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:border-accent">
                        <div className="min-w-0 flex-1">
                          <Mono className="block truncate text-[12.5px] text-ink">{label}</Mono>
                          <div className="text-[11px] text-muted">
                            {new Date(s.createdAt).toLocaleDateString()}
                            {s.status === "paid" && ` · ${currency(s.paidAmount)}`}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          <StatusBadge order={s} />
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* What they actually sold us, device by device, with what we paid —
              the per-person price history behind the next quote. */}
          <CustomerDevices lots={lots} />
        </div>

        {/* --- Conversation: what staff actually work in -------------------- */}
        <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
          <SectionLabel icon={MessageSquare}>Conversation</SectionLabel>
          {/* Fixed-height flex column so the thread scrolls internally and the
              composer stays put, instead of the page growing without limit. On
              desktop the height comes from the grid row rather than a vh sum,
              so it fills whatever is left over exactly. */}
          <Card
            className="flex h-[70vh] flex-col lg:h-auto lg:min-h-0 lg:flex-1"
            onPointerDown={markRead}
            onKeyDownCapture={markRead}
            onFocusCapture={markRead}
          >
            {/* min-h-0 lets this shrink inside the flex column; without it the
                overflow never engages and the composer is pushed off-screen. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MessageThread messages={c.messages} />
            </div>
            {/* One object for both, and `canText` rather than a hand-rolled
                smsOptedOut test — the deployment-wide switch has to close this
                composer too, and a local branch would have missed it. */}
            <ContactRestrictionNotice contact={contact} className="mx-3 mb-2" />
            {contactRestriction(contact)?.canText !== false && <Composer onSend={sendMessage} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * One lifetime-stat cell. The label sits on its own line and is allowed to
 * wrap; the value never does — a date wrapping mid-string is what made these
 * read as overlapping text.
 */
function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9.5px] font-bold uppercase leading-tight tracking-wide text-muted">
        {label}
      </span>
      <div className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
