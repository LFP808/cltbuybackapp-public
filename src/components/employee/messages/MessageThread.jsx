"use client";

import { useEffect, useRef } from "react";
import { Zap, AlertTriangle, User } from "lucide-react";
import { roleLabel } from "@/domain/roles";
import { cn } from "@/lib/cn";
import { groupMessages } from "@/domain/thread";

/**
 * Scrollable message thread. Outbound bubbles only (we send to customers; any
 * inbound replies would arrive via a Twilio webhook, a later addition).
 * Consecutive same-type messages form a run sharing one tail + timestamp.
 * An admin's reply gets its own bubble tint (violet, vs. the VA's accent
 * blue) so whoever is reading back through a thread can tell who answered
 * without reading every attribution line.
 */
export function MessageThread({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] italic text-muted">
        No messages yet.
      </div>
    );
  }

  const rows = groupMessages(messages);

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((r, i) => {
        if (r.kind === "date") {
          return (
            <div key={`d${i}`} className="my-2 text-center">
              {/* Same class of mismatch as the inbox timestamps: dateLabel
                  compares against a fresh `new Date()`, so a thread rendered
                  across midnight says "Today" on the server and "Yesterday" on
                  the client. Vanishingly rare, identical cause — and the client
                  is the one that's right. */}
              <span
                suppressHydrationWarning
                className="rounded-pill bg-bg px-2.5 py-1 text-[11px] font-bold text-muted"
              >
                {r.label}
              </span>
            </div>
          );
        }

        const { msg, type, isRunStart, isRunEnd } = r;
        const inbound = type === "inbound";
        // The admin and the VA answer from the same thread, and from the
        // customer's side a reply is a reply — but internally, "who said
        // this" is exactly what a run's attribution line already names, so
        // the bubble color repeats it at a glance without reading the label.
        const isAdminReply = type === "manual" && msg.byRole === "admin";
        return (
          <div
            key={i}
            className={cn(
              "flex min-w-0 flex-col",
              inbound ? "items-start" : "items-end",
              isRunStart ? "mt-2.5" : "mt-0.5",
            )}
          >
            <div
              className={cn(
                // min-w-0 matters as much as max-w here: without it the bubble's
                // automatic minimum is the longest unbreakable token, so a label
                // URL widens the whole column and pushes the page sideways.
                // The percentage keeps the shape on narrow screens; the ch cap
                // takes over on wide ones. The conversation panel now fills the
                // display, and a bubble that tracked it to 1200px would be one
                // unreadable line of text per message.
                "min-w-0 max-w-[85%] rounded-[18px] sm:max-w-[78%] lg:max-w-[min(78%,72ch)]",
                msg.mediaUrl ? "p-1.5" : "px-3.5 py-2.5",
                inbound
                  ? cn("border border-line bg-white text-ink", isRunEnd && "rounded-bl-[5px]")
                  : isAdminReply
                    ? cn("bg-violet-50 text-violet-900", isRunEnd && "rounded-br-[5px]")
                    : cn("bg-accent-l text-accent-dark", isRunEnd && "rounded-br-[5px]"),
              )}
            >
              {/* Who this came from, in the same slot the Automated tag uses.
                  Only on the first bubble of a run, so a back-and-forth isn't
                  three lines of attribution per reply — and only outbound,
                  since the other side is the person you are looking at. */}
              {isRunStart && type !== "inbound" && (
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide opacity-75",
                    isAdminReply ? "text-violet-700" : "text-accent",
                  )}
                >
                  {type === "auto" ? (
                    <>
                      <Zap size={10} /> Automated
                    </>
                  ) : (
                    msg.by && (
                      <>
                        <User size={10} />
                        <span className="truncate">{msg.by}</span>
                        {msg.byRole && (
                          <span className="font-semibold opacity-70">
                            &middot; {roleLabel(msg.byRole)}
                          </span>
                        )}
                      </>
                    )
                  )}
                </div>
              )}
              {msg.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={msg.mediaUrl}
                  alt="Attachment"
                  className="mb-1 block max-w-full rounded-[13px]"
                />
              )}
              {msg.text && (
                // `anywhere` (not break-words) so a 400-char pasted URL wraps
                // AND stops inflating the element's min-content width.
                <div className="whitespace-pre-wrap text-[13.5px] leading-snug [overflow-wrap:anywhere]">
                  {msg.text}
                </div>
              )}
              {!msg.text && !msg.mediaUrl && (
                // Twilio never delivers a message with neither text nor media,
                // so an empty bubble is a photo whose re-host failed before the
                // webhook learned to keep Twilio's URL (2026-09-25). Say so:
                // a blank pill in a customer thread reads as a bug, not a photo.
                <div className="text-[12.5px] italic text-muted">
                  Photo attachment could not be saved
                </div>
              )}
            </div>
            {isRunEnd && (
              <div
                className={cn(
                  "mt-1 flex items-center gap-1.5 text-[10.5px] text-muted",
                  inbound ? "pl-1" : "pr-1",
                )}
              >
                {new Date(msg.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {msg.testMode && (
                  <span className="rounded-pill border border-line bg-bg px-1.5 py-px text-[9.5px] font-semibold">
                    test mode
                  </span>
                )}
                {/* Only failures are called out. A green tick on every message
                    is noise; "this one didn't arrive" is the thing staff must
                    not miss, and it used to be invisible. */}
                {(msg.deliveryStatus === "failed" || msg.deliveryStatus === "undelivered") && (
                  <span className="flex items-center gap-1 rounded-pill bg-red-50 px-1.5 py-px text-[9.5px] font-bold text-destructive">
                    <AlertTriangle size={10} />
                    Not delivered{msg.deliveryError ? ` (${msg.deliveryError})` : ""}
                  </span>
                )}
                {msg.deliveryStatus === "delivered" && (
                  <span className="text-[9.5px] font-semibold text-accent">Delivered</span>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
