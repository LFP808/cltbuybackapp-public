"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff, Loader2 } from "lucide-react";
import { fmtPhone } from "@/domain/format";
import { cn } from "@/lib/cn";

/**
 * The browser phone.
 *
 * Registers a Twilio Voice device for the signed-in staff member so incoming
 * TwiML addressed to <Client>their-id</Client> rings here, and exposes a
 * `call(number)` any page can use for click-to-call.
 *
 * MOUNTED ONCE, IN THE SHELL. A device per page would re-register on every
 * navigation and drop a live call; one at the top means the call survives
 * walking from the customer page to the order page mid-conversation, which is
 * exactly what someone on a call does.
 *
 * The SDK is imported lazily. It pulls in a WebRTC stack that has no business
 * in the bundle of anyone who never takes a call, and it touches browser APIs
 * that do not exist during server rendering.
 */

const VoiceContext = createContext({
  ready: false,
  status: "offline",
  call: () => {},
  hangUp: () => {},
});

export function useVoice() {
  return useContext(VoiceContext);
}

export function Softphone({ enabled = false, children }) {
  const router = useRouter();
  const deviceRef = useRef(null);
  const connectionRef = useRef(null);

  // offline | connecting | ready | incoming | active | error
  const [status, setStatus] = useState("offline");
  const [error, setError] = useState("");
  const [incoming, setIncoming] = useState(null); // { from }
  const [active, setActive] = useState(null); // { number, direction, startedAt }
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let device = null;

    (async () => {
      try {
        setStatus("connecting");
        const res = await fetch("/api/voice/token");
        if (!res.ok) {
          const { error: msg } = await res.json().catch(() => ({}));
          throw new Error(msg || "Could not get a voice token.");
        }
        const { token } = await res.json();
        if (cancelled) return;

        const { Device } = await import("@twilio/voice-sdk");
        if (cancelled) return;

        device = new Device(token, {
          // Opus where available; Twilio falls back on its own.
          codecPreferences: ["opus", "pcmu"],
          // Without this the SDK drops the call rather than riding out a brief
          // network blip — laptops on office wifi do that constantly.
          maxCallSignalingTimeoutMs: 30000,
        });
        deviceRef.current = device;

        device.on("registered", () => !cancelled && setStatus("ready"));
        device.on("unregistered", () => !cancelled && setStatus("offline"));
        device.on("error", (e) => {
          if (cancelled) return;
          setError(e?.message || "Voice error.");
          setStatus("error");
        });

        device.on("incoming", (conn) => {
          if (cancelled) return;
          connectionRef.current = conn;
          setIncoming({ from: conn.parameters?.From || "" });
          setStatus("incoming");

          const clear = () => {
            connectionRef.current = null;
            setIncoming(null);
            setActive(null);
            setMuted(false);
            setStatus("ready");
            // The call row changed (answered, ended, recorded) — re-read it.
            router.refresh();
          };
          conn.on("accept", () => {
            setIncoming(null);
            setActive({
              number: conn.parameters?.From || "",
              direction: "inbound",
              startedAt: Date.now(),
            });
            setStatus("active");
            router.refresh();
          });
          conn.on("disconnect", clear);
          conn.on("cancel", clear);
          conn.on("reject", clear);
        });

        // Tokens expire; the SDK asks for a fresh one rather than going quiet.
        device.on("tokenWillExpire", async () => {
          try {
            const r = await fetch("/api/voice/token");
            if (r.ok) device.updateToken((await r.json()).token);
          } catch {
            /* the next incoming call will surface it */
          }
        });

        await device.register();
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || "Voice unavailable.");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        device?.destroy();
      } catch {
        /* already gone */
      }
      deviceRef.current = null;
    };
  }, [enabled, router]);

  const call = useCallback(
    async (number) => {
      const device = deviceRef.current;
      if (!device || !number) return;
      try {
        const conn = await device.connect({ params: { To: String(number) } });
        connectionRef.current = conn;
        setActive({ number, direction: "outbound", startedAt: Date.now() });
        setStatus("active");

        const clear = () => {
          connectionRef.current = null;
          setActive(null);
          setMuted(false);
          setStatus("ready");
          router.refresh();
        };
        conn.on("disconnect", clear);
        conn.on("cancel", clear);
        conn.on("error", clear);
      } catch (err) {
        setError(err?.message || "Could not place that call.");
      }
    },
    [router],
  );

  const accept = useCallback(() => connectionRef.current?.accept(), []);
  const reject = useCallback(() => connectionRef.current?.reject(), []);
  const hangUp = useCallback(() => {
    connectionRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
  }, []);
  const toggleMute = useCallback(() => {
    const conn = connectionRef.current;
    if (!conn) return;
    const next = !conn.isMuted();
    conn.mute(next);
    setMuted(next);
  }, []);

  return (
    <VoiceContext.Provider value={{ ready: status === "ready", status, error, call, hangUp }}>
      {children}
      {enabled && (incoming || active) && (
        <CallPanel
          incoming={incoming}
          active={active}
          muted={muted}
          onAccept={accept}
          onReject={reject}
          onHangUp={hangUp}
          onToggleMute={toggleMute}
        />
      )}
    </VoiceContext.Provider>
  );
}

/**
 * The ringing / in-call panel.
 *
 * Portalled and fixed to the bottom-right so it outlives navigation and never
 * ends up inside a transformed ancestor. Deliberately not a modal: an
 * assistant on a call needs to open the customer's orders while talking.
 */
function CallPanel({ incoming, active, muted, onAccept, onReject, onHangUp, onToggleMute }) {
  const number = incoming?.from || active?.number || "";
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-white p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full",
            incoming ? "animate-pulse bg-accent-l text-accent" : "bg-accent text-white",
          )}
        >
          {incoming ? <PhoneIncoming size={18} /> : <Phone size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-[15px] text-ink">
            {fmtPhone(number.replace(/^\+1/, "")) || "Unknown number"}
          </div>
          <div className="text-[12px] text-muted">
            {incoming ? "Incoming call" : active?.direction === "outbound" ? "Calling…" : "On call"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {incoming ? (
          <>
            <button
              onClick={onAccept}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[13px] font-bold text-white hover:bg-accent-dark"
            >
              <Phone size={15} /> Answer
            </button>
            <button
              onClick={onReject}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-muted hover:border-red-400 hover:text-red-500"
            >
              <PhoneOff size={15} /> Decline
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onToggleMute}
              aria-pressed={muted}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold",
                muted
                  ? "border-accent bg-accent-l text-accent"
                  : "border-line text-muted hover:border-accent hover:text-accent",
              )}
            >
              {muted ? <MicOff size={15} /> : <Mic size={15} />}
              {muted ? "Muted" : "Mute"}
            </button>
            <button
              onClick={onHangUp}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 py-2 text-[13px] font-bold text-white hover:bg-red-600"
            >
              <PhoneOff size={15} /> Hang up
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Small header indicator: whether this browser is able to take calls. */
export function VoiceStatus() {
  const { status, error } = useVoice();
  if (status === "offline") return null;

  const map = {
    connecting: { label: "Connecting phone…", tone: "text-muted", icon: Loader2, spin: true },
    ready: { label: "Phone ready", tone: "text-accent", icon: Phone },
    incoming: { label: "Ringing", tone: "text-accent", icon: PhoneIncoming },
    active: { label: "On a call", tone: "text-accent", icon: Phone },
    error: { label: error || "Phone offline", tone: "text-red-500", icon: PhoneOff },
  };
  const s = map[status] || map.error;
  const Icon = s.icon;

  return (
    <span
      title={s.label}
      className={cn("hidden items-center gap-1.5 text-[11.5px] font-semibold sm:flex", s.tone)}
    >
      <Icon size={13} className={s.spin ? "animate-spin" : undefined} />
      <span className="hidden lg:inline">{s.label}</span>
    </span>
  );
}
