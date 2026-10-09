"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Phone, Send } from "lucide-react";
import { Card, Button } from "@/components/ui";
import { MessageThread } from "@/components/employee/messages/MessageThread";
import { CallButton } from "@/components/employee/voice/CallButton";
import { CallCustomerButton } from "@/components/employee/voice/CallCustomerButton";
import { ContactRestrictionNotice } from "@/components/employee/ContactRestrictionNotice";
import { SmsCost } from "@/components/employee/messages/SmsCost";
import { contactRestriction } from "@/domain/contact-status";
import { messageCustomerAction } from "@/app/employee/actions";
import { runAction } from "@/lib/run-action";
import { fmtPhone } from "@/domain/format";

/**
 * One customer, one conversation, nothing else.
 *
 * The inbox is built for someone working a queue: a list of contacts, order
 * history, notes, tags. Someone mid-meetup needs none of it — they need to
 * say "running five minutes late" and to hear back. Everything that is not
 * the conversation is a thing to scroll past one-handed on a phone.
 *
 * Scoped to the ORDER rather than the phone number, so the existing
 * permission applies unchanged. No new access surface, no second rule to
 * keep in sync.
 */
export function SimpleThread({ order, messages = [], backHref = "/calendar", contact = null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // The carrier blocks everything to a STOPped number, so there is nothing to
  // type. Read through the shared predicate rather than the raw flag, so this
  // agrees with the notice rendered right above it.
  const blocked = contactRestriction(contact)?.canText === false;

  async function send() {
    const body = text.trim();
    // Guarded here as well as on the controls: the Enter key used to reach this
    // straight past the disabled Send button, so the sender got the server's
    // refusal instead of never being offered the send.
    if (!body || sending || blocked) return;
    setSending(true);
    setError("");
    const { ok, error } = await runAction(
      () => messageCustomerAction(order.id, body),
      "Could not send that message.",
    );
    setSending(false);

    // Keep what they typed if it didn't send — retyping a message because the
    // box cleared itself is the worst version of this.
    if (!ok) {
      setError(error);
      return;
    }
    setText("");
    router.refresh();
  }

  return (
    // A single screen-height column: the thread scrolls, the composer never
    // moves. On a phone a composer that drifts off the bottom is the difference
    // between replying and giving up.
    <div className="flex h-[calc(100vh-7rem)] w-full max-w-2xl flex-col">
      <Link
        href={backHref}
        className="mb-2 inline-flex flex-shrink-0 items-center gap-1 self-start text-[13px] font-bold text-accent"
      >
        <ChevronLeft size={16} /> Back
      </Link>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-line px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif text-[16px] text-ink">{order.name}</div>
            <div className="text-[12.5px] text-muted">{fmtPhone(order.phone)}</div>
          </div>
          {/* A real tel: link, not the softphone: this is used at the kerb on a
              mobile, where the native dialer always works. The in-app button
              appears alongside it only when a device is registered. */}
          <a
            href={`tel:+1${order.phone}`}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-bold text-white"
          >
            <Phone size={15} /> Call
          </a>
          <CallButton phone={order.phone} label="In app" />
          <CallCustomerButton phone={order.phone} name={order.name} label="Via my phone" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.length > 0 ? (
            <MessageThread messages={messages} />
          ) : (
            <p className="py-8 text-center text-[13px] italic text-muted">
              No messages yet. Anything you send goes to {fmtPhone(order.phone)}.
            </p>
          )}
        </div>

        {error && <p className="flex-shrink-0 px-3.5 pb-1 text-[12.5px] text-red-500">{error}</p>}

        {/* Conditional: the notice renders null when there is no restriction,
            and an unconditional wrapper left a divider and an empty band above
            the composer for every ordinary contact. */}
        {contactRestriction(contact) && (
          <div className="flex-shrink-0 border-t border-line px-2.5 pt-2.5">
            <ContactRestrictionNotice contact={contact} />
          </div>
        )}

        <div className="flex flex-shrink-0 flex-col gap-1 border-t border-line p-2.5">
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; shift+Enter is a line break. A text message is one
                // paragraph, and on a phone the send button is a reach away.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              disabled={blocked}
              placeholder={blocked ? "This customer can't be texted." : "Type a message…"}
              className="min-w-0 flex-1 resize-none rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-accent disabled:bg-bg disabled:text-muted"
            />
            <Button disabled={sending || !text.trim() || blocked} onClick={send}>
              <Send size={15} />
              <span className="sr-only sm:not-sr-only">{sending ? "Sending…" : "Send"}</span>
            </Button>
          </div>
          <SmsCost text={text} />
        </div>
      </Card>
    </div>
  );
}
