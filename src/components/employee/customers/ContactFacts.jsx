"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Wallet, Pencil, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { PAYMENT_METHODS, LEAD_SOURCES } from "@/domain/constants";
import { runAction } from "@/lib/run-action";
import { saveContactProfileAction } from "@/app/employee/customers/actions";

/**
 * Where this customer came from, and how they like to be paid.
 *
 * Two standing facts about the PERSON (contact_notes, migration 0029), shown
 * beside the notes on the customer page and the inbox panel. Read-only until
 * the pencil is pressed, same philosophy as ContactNotesEditor: these are
 * reference material that changes rarely and gets read at payout time.
 *
 * The payment handle is the fact that earns the panel its place: a customer
 * paid by app is paid to a handle, and "their Zelle is..." otherwise lives
 * in a text message somebody has to go find with money waiting.
 */
export function ContactFacts({ phone, leadSource, preferredPaymentMethod, paymentHandle }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    source: leadSource || "",
    method: preferredPaymentMethod || "",
    handle: paymentHandle || "",
  });

  // Presets plus whatever this contact already has — an existing free-text
  // source must appear selected, not vanish into "Other".
  const sourceOptions = [...new Set([...LEAD_SOURCES, ...(leadSource ? [leadSource] : [])])];

  const empty = !leadSource && !preferredPaymentMethod && !paymentHandle;

  function open() {
    setForm({
      source: leadSource || "",
      method: preferredPaymentMethod || "",
      handle: paymentHandle || "",
    });
    setError("");
    setEditing(true);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const { ok, error: message } = await runAction(() =>
        saveContactProfileAction(phone, {
          leadSource: form.source,
          preferredPaymentMethod: form.method,
          paymentHandle: form.handle,
        }),
      );
      if (!ok) return setError(message);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            Source &amp; payment
          </span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Stop editing"
            className="text-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink">How they found us</span>
          <select
            value={form.source}
            onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[13px]"
          >
            <option value="">Not recorded</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink">Pays by</span>
            <select
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
              className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[13px]"
            >
              <option value="">No preference</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink">Send payment to</span>
            <Input
              placeholder="email / $cashtag / handle"
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
            />
          </label>
        </div>

        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          Source &amp; payment
        </span>
        <button
          type="button"
          onClick={open}
          aria-label="Edit source and payment"
          className="text-muted hover:text-ink"
        >
          <Pencil size={13} />
        </button>
      </div>
      {empty ? (
        <p className="mt-1 text-[12.5px] italic text-muted">
          No source or payment preference recorded yet.
        </p>
      ) : (
        <div className="mt-1 space-y-1 text-[12.5px] text-ink">
          {leadSource && (
            <p className="flex items-center gap-1.5">
              <Megaphone size={16} className="flex-shrink-0 text-accent" />
              {leadSource}
            </p>
          )}
          {(preferredPaymentMethod || paymentHandle) && (
            <p className="flex items-center gap-1.5">
              <Wallet size={13} className="flex-shrink-0 text-muted" />
              <span>
                {preferredPaymentMethod || "Payment"}
                {paymentHandle && (
                  <>
                    {" "}
                    → <span className="font-semibold">{paymentHandle}</span>
                  </>
                )}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
