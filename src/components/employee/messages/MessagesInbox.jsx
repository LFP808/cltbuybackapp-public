"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageSquare, ChevronLeft, Users, X, Megaphone } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui";
import { fmtPhone, normPhone } from "@/domain/format";
import { timeAgoShort } from "@/domain/thread";
import { MessageThread } from "./MessageThread";
import { Composer } from "./Composer";
import { ContactProfile } from "./ContactProfile";
import { ContactRestrictionNotice } from "@/components/employee/ContactRestrictionNotice";
import { contactRestriction } from "@/domain/contact-status";
import {
  sendMessageAction,
  saveContactNotesAction,
  markReadAction,
} from "@/app/employee/messages/actions";
import { runAction } from "@/lib/run-action";
import { useTypingPresence } from "@/lib/use-typing-presence";

/**
 * Three-pane messaging inbox: conversation list, thread, and contact profile.
 * Server-loaded `initialConversations` are the source of truth; after a send
 * or notes edit we re-fetch via router.refresh(), with an optimistic message
 * append so sending feels instant.
 */
export function MessagesInbox({
  initialConversations,
  initialSelected,
  messagingOff = false,
  currentStaff,
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [conversations, setConversations] = useState(initialConversations);
  const [selectedPhone, setSelectedPhone] = useState(
    initialSelected || initialConversations[0]?.phone || null,
  );
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const autoSelected = useRef(Boolean(initialSelected || initialConversations[0]));
  /**
   * Whether the CURRENT selection was deliberate — a click, or a ?phone= deep
   * link from the bell. The fallback "first conversation" is not: the list is
   * sorted most-recent-first, so marking it read on paint erased the badge on
   * the newest unread thread before anyone had read a word of it. Read-on-view
   * is the only reply-state this app has, so losing it loses the work item.
   */
  const [explicitSelection, setExplicitSelection] = useState(Boolean(initialSelected));

  // Re-seed from authoritative server data whenever it changes (after refresh).
  useEffect(() => {
    setConversations(initialConversations);
    if (!autoSelected.current && initialConversations[0]) {
      setSelectedPhone(initialConversations[0].phone);
      autoSelected.current = true;
    }
  }, [initialConversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    // Search message bodies too: staff remember what a customer SAID far more
    // often than they remember the number it came from.
    return conversations.filter((c) => {
      if (`${c.name} ${c.phone}`.toLowerCase().includes(q)) return true;
      return c.messages.some((m) => (m.text || "").toLowerCase().includes(q));
    });
  }, [conversations, query]);

  const selected = conversations.find((c) => c.phone === normPhone(selectedPhone)) || null;
  // The deployment-wide switch, folded in ONCE so the notice and the
  // composer's own gate read the same object. Two separate checks is how the
  // notice and the input box previously disagreed about a customer's status.
  const contact = selected ? { ...selected, messagingOff } : null;

  // Lets the other staff member's composer show "X is replying…" on this
  // same thread, so admin and the VA don't both answer the same customer at
  // once. Scoped to the selected conversation only — not enabled while no
  // thread is open.
  const { typingBy, notifyTyping, notifyStopped } = useTypingPresence({
    conversationKey: selected?.phone || null,
    staffId: currentStaff?.id,
    staffName: currentStaff?.name,
    enabled: Boolean(selected),
  });

  /**
   * A conversation on screen has been read — however it got there.
   *
   * This used to hang off the click handler, which missed the case that
   * matters most: arriving from the notification bell at /messages?phone=...
   * selects a conversation without anyone clicking the list, so the reply
   * stayed unread and the bell kept counting it after it had been read.
   *
   * "On screen" requires a person LOOKING at the screen. Without the
   * engagement gate, an inbox left open on a thread marked every new reply in
   * it read the moment realtime refreshed the page — the badge and the bell
   * never lit, and the reply sat answered-looking and unanswered. A reply that
   * lands while the tab is hidden stays unread until the tab comes back.
   *
   * Clearing the count locally first is what stops this looping — the refresh
   * brings back unreadCount 0, so the effect declines to run again.
   */
  useEffect(() => {
    if (!explicitSelection) return;
    if (!selected || !(selected.unreadCount > 0)) return;

    const markIfEngaged = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
      const key = selected.phone;
      setConversations((prev) => prev.map((c) => (c.phone === key ? { ...c, unreadCount: 0 } : c)));
      // Best-effort: an expired session here must not become an unhandled rejection.
      markReadAction(key)
        .then(() => startTransition(() => router.refresh()))
        .catch(() => {});
      return true;
    };

    if (markIfEngaged()) return;
    // Not looking right now: mark the moment attention returns, and only then.
    const onAttention = () => {
      if (markIfEngaged()) cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("focus", onAttention);
      document.removeEventListener("visibilitychange", onAttention);
    };
    window.addEventListener("focus", onAttention);
    document.addEventListener("visibilitychange", onAttention);
    return cleanup;
  }, [selected, router, explicitSelection]);

  function selectConversation(phone) {
    setSelectedPhone(phone);
    setExplicitSelection(true);
    setProfileOpen(false);
  }

  async function handleSend(text, image) {
    if (!selected) return;
    // Optimistic append (the authoritative message arrives on refresh).
    const optimistic = {
      text,
      at: Date.now(),
      direction: "outbound",
      auto: false,
      by: "You",
      mediaUrl: null,
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.phone === selected.phone ? { ...c, messages: [...c.messages, optimistic] } : c,
      ),
    );

    const { ok, error } = await runAction(() => sendMessageAction(selected.phone, text, image));
    if (!ok) {
      // Take the optimistic bubble back down — leaving it up is a message the
      // customer never received, sitting in the thread looking sent.
      setConversations((prev) =>
        prev.map((c) =>
          c.phone === selected.phone
            ? { ...c, messages: c.messages.filter((m) => m !== optimistic) }
            : c,
        ),
      );
      // Rethrown client-side (nothing strips this) so the Composer shows it and
      // keeps what was typed.
      throw new Error(error);
    }
    startTransition(() => router.refresh());
  }

  /** Returns the outcome so ContactNotesEditor can report a refusal. */
  async function handleSaveNotes(data) {
    if (!selected) return undefined;
    const previous = conversations;
    setConversations((prev) =>
      prev.map((c) => (c.phone === selected.phone ? { ...c, ...data } : c)),
    );

    const { ok, error } = await runAction(() => saveContactNotesAction(selected.phone, data));
    if (!ok) {
      setConversations(previous); // undo the optimistic merge
      return { error };
    }
    startTransition(() => router.refresh());
    return undefined;
  }

  return (
    <div className="flex h-[calc(100vh-190px)] min-h-[460px] items-stretch gap-4">
      {/* Conversation list */}
      <div
        className={cn(
          "w-full flex-shrink-0 overflow-y-auto rounded-card border-[1.5px] border-line bg-white lg:w-64",
          selected && "hidden lg:block",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-card border-b border-line bg-white px-3 py-2.5 text-muted">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={MessageSquare}>
            {conversations.length === 0
              ? "No conversations yet — texts appear here once a shipment goes out."
              : "No contacts match your search."}
          </EmptyState>
        ) : (
          filtered.map((c) => {
            const unread = c.unreadCount > 0;
            return (
              <button
                key={c.phone}
                onClick={() => selectConversation(c.phone)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-line p-3 text-left hover:bg-bg",
                  c.phone === normPhone(selectedPhone) && "bg-accent-l hover:bg-accent-l",
                )}
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent font-serif text-sm text-white">
                  {c.initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1.5">
                    <span className="flex min-w-0 items-center gap-1">
                      <span
                        className={cn(
                          "truncate text-[13.5px] text-ink",
                          unread ? "font-extrabold" : "font-bold",
                        )}
                      >
                        {c.name}
                      </span>
                      {c.leadSource && (
                        <span title={`Source: ${c.leadSource}`}>
                          <Megaphone size={14} className="flex-shrink-0 text-accent" />
                        </span>
                      )}
                    </span>
                    {/* suppressHydrationWarning because this text is SUPPOSED
                        to differ: timeAgoShort reads Date.now(), the server
                        renders "5m", and the client hydrates a second later
                        and says "6m". React treated that as a corrupted tree,
                        logged a hydration error, and re-rendered the whole
                        list. Intermittent by nature — it only fires when a
                        message crosses a minute boundary inside the hydration
                        window, which is why it showed up in one route sweep out
                        of three. The client's value is the correct one. */}
                    <span
                      suppressHydrationWarning
                      className="flex-shrink-0 text-[10.5px] text-muted"
                    >
                      {timeAgoShort(c.lastMessage?.at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12px]",
                        unread ? "font-semibold text-ink" : "text-muted",
                      )}
                    >
                      {conversationPreview(c)}
                    </span>
                    {unread && (
                      <span className="flex h-4 min-w-4 flex-shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Thread */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col rounded-card border-[1.5px] border-line bg-white",
          !selected && "hidden lg:flex",
        )}
      >
        {selected ? (
          <>
            <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
              <button
                onClick={() => setSelectedPhone(null)}
                aria-label="Back"
                className="text-accent lg:hidden"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="min-w-0">
                <div className="truncate font-serif text-[15px] text-ink">
                  {selected.name}
                </div>
                <div className="text-[11.5px] text-muted">{fmtPhone(selected.phone)}</div>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                aria-label="Customer info"
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] border-line text-accent hover:bg-accent-l xl:hidden"
              >
                <Users size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <MessageThread messages={selected.messages} />
            </div>

            <div className="flex-shrink-0 px-4 pb-4">
              {/* THE SHARED NOTICE, not a local branch. This composer used to
                  test `smsOptedOut` by hand, which meant the two states that
                  component exists to explain — replied PAUSE, and "we
                  couldn't check" — never appeared in the one place staff do
                  most of their typing. */}
              <ContactRestrictionNotice contact={contact} className="mb-2 mt-3.5" />
              {typingBy && (
                <div className="mb-1 px-1 text-[11.5px] italic text-muted">
                  {typingBy.name} is replying…
                </div>
              )}
              {/* Keyed by phone: React otherwise keeps the draft text across a
                  conversation switch, so a half-typed message to one customer
                  sat in the box — and could be sent — to the next one. */}
              {contactRestriction(contact)?.canText === false ? null : (
                <Composer
                  key={selected.phone}
                  onSend={handleSend}
                  onTyping={notifyTyping}
                  onStoppedTyping={notifyStopped}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] italic text-muted">
            Select a conversation
          </div>
        )}
      </div>

      {/* Profile — inline on xl, slide-over below */}
      {selected && (
        <>
          <div className="hidden w-72 flex-shrink-0 overflow-y-auto xl:block">
            <ContactProfile conversation={selected} onSaveNotes={handleSaveNotes} />
          </div>

          {profileOpen && (
            <div className="fixed inset-0 z-[70] xl:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-0 top-0 h-full w-[min(340px,88vw)] overflow-y-auto bg-bg p-4 shadow-xl">
                <button
                  onClick={() => setProfileOpen(false)}
                  aria-label="Close"
                  className="mb-2 ml-auto flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] border-line bg-white text-ink"
                >
                  <X size={16} />
                </button>
                <ContactProfile conversation={selected} onSaveNotes={handleSaveNotes} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One-line preview of the last message, prefixed "You:" when we sent it. */
function conversationPreview(c) {
  const m = c.lastMessage;
  if (!m) return "No messages yet";
  const text = m.mediaUrl && !m.text ? "📷 Photo" : m.text;
  return m.direction === "outbound" ? `You: ${text}` : text;
}
