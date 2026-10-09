"use client";

import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Card, SectionLabel } from "@/components/ui";
import { currency, itemsTotal } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { setItemNoteAction } from "@/app/employee/actions";

/**
 * The agreed lines, each with an optional INTERNAL note.
 *
 * PER LINE, NOT PER ORDER (Jaime, 2026-07-30). What gets noted is usually about
 * one device — "the iPhone is cracked, the iPad is fine" — and an
 * order-level box makes the reader work out which line it meant. On a two-line
 * order that guess is wrong half the time.
 *
 * STAFF ONLY. The note never reaches the customer: "cracked" is a judgement we
 * make about what turned up, and a customer reading it before anyone has
 * spoken to them is an argument, not an update.
 *
 * Stored inside the existing `items` jsonb, so this needed no migration. Also
 * shown on the check-in screen against the matching row — a note written on a
 * call is worth most to whoever has the device in hand later.
 */
export function ItemsCard({ shipment, canEdit = true }) {
  if (!shipment.items?.length) return null;
  return (
    <>
      <SectionLabel>Items · {currency(itemsTotal(shipment.items))}</SectionLabel>
      <Card className="mb-4 space-y-1 text-[13px]">
        {shipment.items.map((it, i) => (
          // Items created in the form carry a uid, but rows that arrived any
          // other way (imported, seeded, older records) may not — falling back
          // to the index keeps every key unique instead of all-undefined.
          <ItemRow
            key={it.id || `${it.name}-${i}`}
            item={it}
            index={i}
            orderId={shipment.id}
            canEdit={canEdit}
          />
        ))}
      </Card>
    </>
  );
}

function ItemRow({ item, index, orderId, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(value) {
    setBusy(true);
    setError("");
    const { ok, error: err } = await runAction(() => setItemNoteAction(orderId, index, value));
    setBusy(false);
    if (!ok) {
      setError(err);
      return;
    }
    setEditing(false);
  }

  return (
    <div className="border-b border-line/50 py-1.5 last:border-0">
      <div className="flex justify-between gap-3">
        <span className="min-w-0 text-ink">
          {Number(item.quantity) > 1 ? `${item.quantity}× ` : ""}
          {item.name}
          {/* What the customer SAID the condition was, at booking. Check-in
              decides the grade; this is the claim it gets measured against. */}
          {item.condition && (
            <span
              className="ml-1.5 inline-flex rounded-pill bg-bg px-1.5 py-px align-middle text-[10.5px] font-semibold text-muted ring-1 ring-inset ring-line"
              title="Condition stated at booking"
            >
              {item.condition}
            </span>
          )}
          {/* Same claim-vs-measured relationship as condition above, for
              carrier lock status. */}
          {item.carrier && (
            <span
              className="ml-1.5 inline-flex rounded-pill bg-bg px-1.5 py-px align-middle text-[10.5px] font-semibold text-muted ring-1 ring-inset ring-line"
              title="Carrier stated at booking"
            >
              {item.carrier}
            </span>
          )}
        </span>
        {/* Coerced: an unpriced item is $0, not NaN. Prices are entered at
            payout, so "no price yet" is a normal state, not bad data. */}
        <span className="flex-shrink-0 text-muted">
          {currency((Number(item.price) || 0) * (Number(item.quantity) || 0))}
        </span>
      </div>

      {editing ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(text);
              if (e.key === "Escape") {
                setText(item.note || "");
                setEditing(false);
              }
            }}
            placeholder="e.g. cracked screen, Find My still on, no charger"
            aria-label={`Note for ${item.name}`}
            autoFocus
            maxLength={300}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-[12.5px] outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => save(text)}
            className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setText(item.note || "");
              setEditing(false);
            }}
            className="text-[12px] font-semibold text-muted"
          >
            Cancel
          </button>
        </div>
      ) : item.note ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setEditing(true)}
          className="mt-1 flex w-full items-start gap-1.5 text-left text-[12px] text-status-awaiting disabled:cursor-default"
        >
          <StickyNote size={12} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0">
            {item.note}
            {/* Attribution in place, not in the activity trail: "who decided
                this was cracked" is the first thing anyone asks about a note
                like this, and it belongs on the line it describes. */}
            {item.noteBy && (
              <span className="text-muted">
                {" — "}
                {item.noteBy}
                {item.noteAt ? `, ${new Date(item.noteAt).toLocaleDateString()}` : ""}
              </span>
            )}
          </span>
        </button>
      ) : (
        canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-0.5 text-[11.5px] font-semibold text-accent"
          >
            + note
          </button>
        )
      )}

      {error && <p className="mt-1 text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
