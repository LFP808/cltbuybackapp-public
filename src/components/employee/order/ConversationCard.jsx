"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button, Card, SectionLabel } from "@/components/ui";
import { MessageThread } from "@/components/employee/messages/MessageThread";
import { SmsCost } from "@/components/employee/messages/SmsCost";
import { CallHistory } from "@/components/employee/calls/CallHistory";
import { CallButton } from "@/components/employee/voice/CallButton";
import { CallCustomerButton } from "@/components/employee/voice/CallCustomerButton";
import { ContactRestrictionNotice } from "@/components/employee/ContactRestrictionNotice";
import { contactRestriction } from "@/domain/contact-status";
import { fmtPhone } from "@/domain/format";
import { messageCustomerAction } from "@/app/employee/actions";
import { runAction } from "@/lib/run-action";

/**
 * The right-hand column of the order page: the customer's thread, recent
 * calls, and the composer. Rendered only where contact is allowed; see
 * canContactOrder.
 *
 * `onError` reports send failures upward: the page owns the single error line,
 * so the composer cannot invent a second place errors appear.
 */
export function ConversationCard({
  shipment,
  messages = [],
  calls = [],
  contact = null,
  canMessage = true,
  busy = false,
  onError,
}) {
  return (
    <>
      {/* The conversation, where it is allowed - see canContactOrder.
        Reading it matters as much as sending: "running ten minutes late"
        is usually already in the thread.

        Height comes from the grid row rather than a vh sum, so it fills
        exactly what is left over and the composer is always on screen. */}
      {canMessage && (
        <div className="flex min-w-0 flex-col lg:min-h-0">
          <SectionLabel>Customer</SectionLabel>
          <Card className="mb-4 flex h-[70vh] flex-col overflow-hidden p-0 lg:h-auto lg:min-h-0 lg:flex-1">
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-3">
              <span className="text-[13px] font-semibold text-ink">{fmtPhone(shipment.phone)}</span>
              <span className="flex items-center gap-1">
                <CallButton phone={shipment.phone} />
                <CallCustomerButton phone={shipment.phone} name={shipment.name} />
              </span>
            </div>

            {/* min-h-0 or the overflow never engages and the composer is
              pushed off the bottom of the card. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {messages.length > 0 ? (
                <MessageThread messages={messages} />
              ) : (
                <p className="py-6 text-center text-[12.5px] italic text-muted">
                  No messages with this customer yet.
                </p>
              )}

              {calls.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                    Calls
                  </h3>
                  <CallHistory calls={calls} limit={3} />
                </div>
              )}
            </div>

            <div className="flex-shrink-0 space-y-2 border-t border-line p-2.5">
              <ContactRestrictionNotice contact={contact} />
              {/* A carrier block means nothing we type arrives, so the box
                goes away rather than inviting a message into a void.
                Through the shared predicate, not the raw flag: only STOP
                withdraws the composer — PAUSE and an unverified status
                both leave it usable. */}
              {contactRestriction(contact)?.canText !== false && (
                <MessageComposer orderId={shipment.id} disabled={busy} onError={onError} />
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function MessageComposer({ orderId, disabled, onError }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    onError("");
    const { ok, error } = await runAction(
      () => messageCustomerAction(orderId, text.trim()),
      "Could not send message.",
    );
    setSending(false);

    // Keep the text when it didn't send.
    if (!ok) {
      onError(error);
      return;
    }
    setText("");
  }

  return (
    // Bare row, not a card of its own: it lives in the footer of the
    // conversation card now, the way a composer sits under a thread.
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, shift+Enter breaks the line. Anyone typing here is
            // typing a text message, and a text message is one paragraph.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Type a text to the customer…"
          className="min-w-0 flex-1 resize-none rounded-lg border border-line px-3 py-2 text-[13px] outline-none focus:border-accent"
        />
        <Button disabled={disabled || sending || !text.trim()} onClick={send}>
          <Send size={15} />
          <span className="sr-only sm:not-sr-only">Send</span>
        </Button>
      </div>
      <SmsCost text={text} />
    </div>
  );
}
