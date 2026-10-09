"use client";

import { useState } from "react";
import { Card, Button } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { CALL_MODES, BUSY_MESSAGE_MAX } from "@/domain/phone-menu";
import { saveIncomingCallsAction } from "@/app/employee/settings/actions";

/**
 * What happens when someone calls: the mode, and the sentence "message" mode
 * speaks. One Save for both, the same pattern as the meetup-location card -
 * the message is a draft worth reading back before callers hear it, so this
 * one does not save on the click.
 *
 * The message box is only shown for the mode that speaks it, and the menu
 * script (read-only: `menuGreeting` / `menuInfo` are built on the server by
 * the same domain/phone-menu.js functions the webhooks call) only for the
 * mode that plays it. The stored message survives a switch to another mode
 * and back - it is saved either way.
 */
export function IncomingCallsCard({
  mode: initialMode,
  message: initialMessage,
  menuGreeting,
  menuInfo,
}) {
  const [mode, setMode] = useState(initialMode);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const {
      ok,
      error: err,
      result,
    } = await runAction(() => saveIncomingCallsAction({ mode, message }));
    setBusy(false);
    if (!ok) {
      setError(err);
      return;
    }
    // Snap to what was stored (whitespace collapsed), so the box shows what
    // the caller will hear.
    if (result?.value) setMessage(result.value.message);
    setSaved(true);
  }

  const edit = (fn) => (value) => {
    setSaved(false);
    fn(value);
  };

  return (
    <Card>
      <div className="text-[14px] font-bold text-ink">Incoming calls</div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        What happens when someone calls the business number.
      </p>

      <div className="mt-3 space-y-2">
        {CALL_MODES.map((m) => (
          <label key={m.key} className="flex items-start gap-2">
            <input
              type="radio"
              name="incoming-call-mode"
              value={m.key}
              checked={mode === m.key}
              onChange={() => edit(setMode)(m.key)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <span>
              <span className="block text-[13px] font-medium text-ink">{m.label}</span>
              <span className="block text-[12px] text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === "message" && (
        <div className="mt-3">
          <label
            htmlFor="incoming-call-message"
            className="block text-[12.5px] font-semibold text-ink"
          >
            Message callers hear
          </label>
          <textarea
            id="incoming-call-message"
            rows={3}
            maxLength={BUSY_MESSAGE_MAX}
            value={message}
            onChange={(e) => edit(setMessage)(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
          <p className="mt-1 text-[12px] text-muted">
            Read aloud by a computer voice, so write it the way you would say it. The text they get
            is the usual missed-call text.
          </p>
        </div>
      )}

      {mode === "menu" && (
        <div className="mt-3 space-y-2 rounded-lg bg-bg px-3 py-2.5 text-[12.5px] text-ink">
          <p>
            <span className="font-semibold">Greeting: </span>
            {menuGreeting}
          </p>
          <p>
            <span className="font-semibold">Address and hours: </span>
            {menuInfo || "Nothing to read out yet - set the meetup location above."}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="text-[12px] font-semibold text-accent">
            Saved - the next call is handled this way.
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-500">{error}</p>}
    </Card>
  );
}
