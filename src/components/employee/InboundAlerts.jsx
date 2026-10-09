"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/lib/use-realtime";
import { chime } from "@/lib/chime";

/**
 * Live messages: pushes every new message into the UI, and rings for
 * customer replies.
 *
 * The person answering texts sits on this screen. Before this, a reply only
 * appeared when they happened to click something — the inbox and the unread
 * badge both waited for a navigation, and a teammate's own outbound reply
 * waited even longer, since nothing refreshed on it at all. Now a Postgres
 * insert on `messages`, either direction, arrives over Supabase Realtime and
 * refreshes the server data; only an inbound insert also plays the chime.
 *
 * Mounted once in the employee shell, so the alert follows staff around the app
 * rather than only firing while the inbox is open.
 *
 * TWO MUTES, and they are not the same switch. `soundOn` is this browser's
 * own preference (the bell's toggle, localStorage). `muted` is the /settings
 * "mute for admins" switch, decided on the server by role — it wins over the
 * local preference, and the bell says so (`mutedBySetting`) instead of
 * offering a toggle that would do nothing. Both take away the SOUND only:
 * the subscription, the refresh and the bell's count carry on.
 */

const SOUND_KEY = "cltbb.pingEnabled";
const AlertsContext = createContext({
  soundOn: true,
  toggleSound: () => {},
  mutedBySetting: false,
});

export function useInboundAlerts() {
  return useContext(AlertsContext);
}

export function InboundAlerts({ enabled = true, muted = false, children }) {
  const router = useRouter();
  const [soundOn, setSoundOn] = useState(true);
  const audioRef = useRef(null);
  // Read inside the handler rather than closing over state, so the long-lived
  // Realtime subscription never sees a stale value.
  const soundOnRef = useRef(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SOUND_KEY) === "false") {
        setSoundOn(false);
        soundOnRef.current = false;
      }
    } catch {
      /* storage disabled — default to on */
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      soundOnRef.current = next;
      try {
        window.localStorage.setItem(SOUND_KEY, String(next));
      } catch {
        /* non-fatal */
      }
      // Play on enable so the choice is audible, and so this counts as the
      // user gesture browsers require before audio may start.
      if (next) void chime(audioRef);
      return next;
    });
  }, []);

  // Every insert, not just inbound: a reply typed by the OTHER staff member
  // is outbound too, and without a live refresh it sat invisible on screen
  // until something else happened to reload the page — the VA kept answering
  // a customer admin had already answered, with no way to know. Only the
  // CHIME stays inbound-only (ringing on our own outgoing text would be
  // noise); the refresh now runs for both directions so the thread, the list
  // and the badge stay caught up with whoever is also replying.
  const liveStatus = useRealtime({
    channel: "inbound-messages",
    table: "messages",
    event: "INSERT",
    enabled,
    onChange: useCallback(
      (payload) => {
        if (payload?.new?.direction === "inbound" && soundOnRef.current && !muted) {
          void chime(audioRef);
        }
        // Re-fetch server data so the thread, the conversation list, the nav
        // badge and the notification bell all update from one source of truth.
        router.refresh();
      },
      [router, muted],
    ),
  });

  return (
    <AlertsContext.Provider value={{ soundOn, toggleSound, mutedBySetting: muted }}>
      {children}
      {/* Shown ONLY while degraded. A dead subscription looks exactly like a
          quiet inbox — the one state this feature must never leave invisible —
          so the pill appears while the hook is resubscribing and vanishes the
          moment the channel is live again. No "connected" chrome the rest of
          the time; silence means working, like every other fixture here. */}
      {liveStatus === "reconnecting" && (
        <div className="fixed bottom-4 right-4 z-[80] rounded-pill border border-status-awaiting/40 bg-status-awaiting-bg px-3 py-1.5 text-[12px] font-semibold text-status-awaiting shadow-md">
          Live updates lost — reconnecting. New replies may not appear until this clears.
        </div>
      )}
    </AlertsContext.Provider>
  );
}
