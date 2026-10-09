"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** How long a typing signal lasts before we assume the other side stopped
 * without saying so — a closed tab or dead connection never sends "stopped". */
const IDLE_MS = 4000;

/**
 * Broadcast-only presence for one conversation: "is the OTHER staff member
 * (admin or VA) composing a reply to this same customer right now." Nothing
 * is persisted — this is a live signal between two browsers, gone the moment
 * both tabs close, so it rides Realtime Broadcast rather than a table.
 *
 * Scoped per conversation (one channel per phone number) rather than one
 * global channel, so a VA composing to customer A never lights up admin's
 * view of an unrelated thread with customer B.
 */
export function useTypingPresence({ conversationKey, staffId, staffName, enabled = true }) {
  const [typingBy, setTypingBy] = useState(null); // { name } | null
  const channelRef = useRef(null);
  const idleTimer = useRef(null);

  useEffect(() => {
    setTypingBy(null);
    if (!enabled || !conversationKey || !staffId) return;

    const supabase = createClient();
    let cancelled = false;
    let channel = null;

    async function connect() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      channel = supabase.channel(`typing-${conversationKey}`, {
        config: { broadcast: { self: false } },
      });
      channel.on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.staffId === staffId) return;
        setTypingBy({ name: payload?.name || "Someone" });
        clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setTypingBy(null), IDLE_MS);
      });
      channel.on("broadcast", { event: "stopped" }, ({ payload }) => {
        if (payload?.staffId === staffId) return;
        clearTimeout(idleTimer.current);
        setTypingBy(null);
      });
      channel.subscribe();
      channelRef.current = channel;
    }
    void connect();

    return () => {
      cancelled = true;
      clearTimeout(idleTimer.current);
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staffName deliberately excluded: renaming mid-session shouldn't tear the channel down
  }, [conversationKey, staffId, enabled]);

  function notifyTyping() {
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { staffId, name: staffName },
    });
  }

  function notifyStopped() {
    channelRef.current?.send({ type: "broadcast", event: "stopped", payload: { staffId } });
  }

  return { typingBy, notifyTyping, notifyStopped };
}
