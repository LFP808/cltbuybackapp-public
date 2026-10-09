"use client";

import { useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { addressLine, OFFICE_ADDRESS_FIELDS } from "@/domain/office";
import { foldToGsm7 } from "@/domain/sms";
import { runAction } from "@/lib/run-action";
import { saveOfficeAddressAction } from "@/app/employee/settings/actions";

/**
 * The meetup location, editable in place — the same save pattern as the
 * other /settings cards. Takes the address the app is USING right now
 * (setting, or the env fallback when nothing has been saved) so the fields
 * open on exactly what customers are being texted today.
 *
 * The preview is the real line: the same addressLine() + GSM-7 fold the
 * action stores, so "what will the text say" is answered before Save rather
 * than by booking a test order. Refusals arrive from the action naming the
 * field and land verbatim in the red line.
 */
export function OfficeAddressCard({ address, source }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(OFFICE_ADDRESS_FIELDS.map((key) => [key, address?.[key] || ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Until a save lands, "from env" stays true: the note below explains why
  // the fields are filled in on a page nobody has saved on.
  const [fromEnv, setFromEnv] = useState(source === "env");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Mirrors what the action stores: folded to GSM-7, state upper-cased.
  const preview = addressLine({
    ...Object.fromEntries(OFFICE_ADDRESS_FIELDS.map((key) => [key, foldToGsm7(form[key]).trim()])),
    state: form.state.trim().toUpperCase(),
  });

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const { ok, error: err, result } = await runAction(() => saveOfficeAddressAction(form));
    setBusy(false);
    if (!ok) {
      setError(err);
      return;
    }
    // Snap to what was stored: the fold and the upper-cased state happen in
    // the action, and fields that still show "Suite 7—B" over a saved
    // "Suite 7-B" would look like the save lost something.
    if (result?.value) setForm(result.value);
    setSaved(true);
    setFromEnv(false);
  }

  return (
    <Card>
      <div className="text-[14px] font-bold text-ink">Meetup location</div>
      <p className="mt-0.5 text-[12.5px] text-muted">
        Where customers are told to come. Every booking confirmation and reminder carries it as one
        line.
      </p>

      {fromEnv && (
        <p className="mt-2 rounded-lg bg-status-awaiting-bg px-2.5 py-1.5 text-[12px] text-status-awaiting">
          {address?.street
            ? "Showing the server's environment values - nothing has been saved here yet. Save once and this page is where it lives."
            : 'No address is set anywhere yet - texts say "Come see us at Charlotte, NC" until you save one.'}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-4">
          <Input label="Street" name="street" value={form.street} onChange={set("street")} />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Suite / unit"
            name="street2"
            value={form.street2}
            onChange={set("street2")}
          />
        </div>
        <div className="sm:col-span-3">
          <Input label="City" name="city" value={form.city} onChange={set("city")} />
        </div>
        <div className="sm:col-span-1">
          <Input
            label="State"
            name="state"
            maxLength={2}
            value={form.state}
            onChange={set("state")}
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="ZIP"
            name="zip"
            inputMode="numeric"
            value={form.zip}
            onChange={set("zip")}
          />
        </div>
      </div>

      <p className="mt-3 text-[12px] text-muted">
        {preview ? (
          <>
            Customers read:{" "}
            <span className="text-ink">Come see us at {preview} and get paid for your device!</span>
          </>
        ) : (
          "Fill in a street to see the line customers will read."
        )}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save location"}
        </Button>
        {saved && (
          <span className="text-[12px] font-semibold text-accent">
            Saved - the next confirmation and reminder carry it.
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-500">{error}</p>}
    </Card>
  );
}
