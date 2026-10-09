"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { saveAdminSoundMutedAction } from "@/app/employee/settings/actions";

/**
 * The alert chime, mutable for admins only.
 *
 * Saves the moment the box flips, unlike the cards above: there is one value
 * and no draft worth reviewing, and a Save button under a lone checkbox is a
 * second click that exists to be forgotten. The box moves first and snaps
 * back if the save is refused, so it never shows a state the server doesn't
 * hold.
 *
 * The action revalidates the staff layout, so this very tab goes quiet (or
 * loud again) on the response - no reload.
 */
export function AlertSoundCard({ muted: initial }) {
  const [muted, setMuted] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function toggle(next) {
    setBusy(true);
    setError("");
    setSaved(false);
    setMuted(next);
    const { ok, error: err } = await runAction(() => saveAdminSoundMutedAction(next));
    setBusy(false);
    if (!ok) {
      setMuted(!next);
      setError(err);
      return;
    }
    setSaved(true);
  }

  return (
    <Card>
      <div className="text-[14px] font-bold text-ink">Alert sounds</div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        The chime that plays when a customer texts in or a new lead arrives.
      </p>

      <label className="mt-3 flex items-center gap-2 text-[13px] font-medium text-ink">
        <input
          type="checkbox"
          checked={muted}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Mute for admins
      </label>

      <p className="mt-2 text-[12px] text-muted">
        Sound only - the bell, the unread badges and live updates keep working. Everyone who
        isn&apos;t an admin still hears the chime, and incoming calls still ring.
      </p>

      {saved && (
        <p className="mt-2 text-[12px] font-semibold text-accent">
          {muted ? "Saved - admins won't hear the chime." : "Saved - admins hear the chime again."}
        </p>
      )}
      {error && <p className="mt-2 text-[12px] font-semibold text-red-500">{error}</p>}
    </Card>
  );
}
