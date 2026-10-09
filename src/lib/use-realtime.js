"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Postgres changes over Supabase Realtime, correctly.
 *
 * "Correctly" is doing a lot of work in that sentence, because every half of
 * it fails SILENTLY and identically — the subscription reports SUBSCRIBED and
 * then simply never delivers anything, which is indistinguishable from realtime
 * being switched off:
 *
 *   1. THE SOCKET AUTHENTICATES SEPARATELY FROM REST. `createBrowserClient`
 *      does not hand the session to it, so without `setAuth` the socket still
 *      carries the anon key. Row level security grants `authenticated` only,
 *      so it subscribes happily and hears nothing.
 *
 *   2. ACCESS TOKENS EXPIRE. Pushing each refreshed token back onto the socket
 *      is what stops a subscription going quiet an hour into a shift, with
 *      nothing on screen to say that it had.
 *
 *   3. CHANNELS DIE WITHOUT A WORD. `.subscribe()` accepts a status callback
 *      this hook used to omit, so a CHANNEL_ERROR or TIMED_OUT — a laptop
 *      waking from sleep, a proxy dropping the socket — left the screen frozen
 *      in a state identical to "no new messages". Now an unhealthy channel is
 *      torn down and resubscribed with backoff, and the caller gets a status
 *      to show, because a failure that self-heals invisibly is good but a
 *      failure that persists invisibly is the whole disease.
 *
 * This exists because half of it was written once and then forgotten the
 * next time somebody needed a subscription: the call log went dead on token
 * expiry while the inbox stayed live, and no error was raised in either place.
 * One implementation means the next subscription cannot get it half right.
 *
 * @param {object}   opts
 * @param {string}   opts.channel  unique channel name
 * @param {string}   opts.table    table in the public schema
 * @param {string}   [opts.event]  INSERT | UPDATE | DELETE | * (default *)
 * @param {string}   [opts.filter] PostgREST-style filter, e.g. "direction=eq.inbound"
 * @param {boolean}  [opts.enabled] false unsubscribes entirely — see the note
 *                   in InboundAlerts about not streaming data to roles that
 *                   have no business receiving it
 * @param {(payload: object) => void} opts.onChange
 * @returns {"idle"|"connecting"|"live"|"reconnecting"} channel health, for a
 *   caller that wants to say "live updates are down" instead of looking fine
 */
export function useRealtime({ channel, table, event = "*", filter, enabled = true, onChange }) {
  const [status, setStatus] = useState(enabled ? "connecting" : "idle");
  // Held in a ref so a caller passing an inline arrow doesn't tear down and
  // rebuild the subscription on every render.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    setStatus("connecting");

    const supabase = createClient();
    let sub = null;
    let cancelled = false;
    let retryTimer = null;
    let attempt = 0;

    async function connect() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      sub = supabase
        .channel(channel)
        .on(
          "postgres_changes",
          { event, schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) => handler.current?.(payload),
        )
        .subscribe((state) => {
          if (cancelled) return;
          if (state === "SUBSCRIBED") {
            attempt = 0;
            setStatus("live");
            return;
          }
          // CLOSED is deliberate teardown (ours), never retried — retrying it
          // would fight the cleanup below. The two failure states get a fresh
          // channel AND a fresh token, since an expired token is one of the
          // ways a channel dies quietly.
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
            setStatus("reconnecting");
            scheduleReconnect();
          }
        });
    }

    function scheduleReconnect() {
      if (cancelled || retryTimer) return;
      // 2s, 4s, 8s … capped at 30s: fast enough that a blip heals before
      // anyone notices, slow enough not to hammer a struggling network.
      const delay = Math.min(30_000, 2_000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (cancelled) return;
        if (sub) supabase.removeChannel(sub);
        sub = null;
        void connect();
      }, delay);
    }

    void connect();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      authSub.subscription.unsubscribe();
      if (sub) supabase.removeChannel(sub);
    };
  }, [channel, table, event, filter, enabled]);

  return status;
}
