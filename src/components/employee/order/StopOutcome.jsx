"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button, Modal, DialogFooter } from "@/components/ui";
import { STOP_OUTCOMES, stopOutcomeAnnounces } from "@/domain/orders";
import { reportStopOutcomeAction } from "@/app/employee/actions";
import { cn } from "@/lib/cn";

/**
 * "It didn't happen" — the outcome a booked meetup needs and never had.
 *
 * Leaves the order awaiting: a no-show is a visit to rebook. One outcome
 * texts the customer a rebook invitation (stopOutcomeAnnounces) and the
 * dialog says so before the press — an automatic message staff didn't know
 * about is one they can't answer questions about.
 */
export function StopOutcome({ shipment, busy, run }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(STOP_OUTCOMES[0].key);
  const [note, setNote] = useState("");

  return (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <XCircle size={15} /> Didn&apos;t happen
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="What happened?">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            {STOP_OUTCOMES.map((o) => (
              <button
                key={o.key}
                onClick={() => setOutcome(o.key)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors",
                  outcome === o.key
                    ? "border-accent bg-accent-l text-accent"
                    : "border-line bg-white text-ink hover:border-accent/40",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything worth adding (optional)"
            className="w-full rounded-lg border border-line px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
          <p className="text-[12px] text-muted">
            The order stays open so it can be rebooked.{" "}
            {stopOutcomeAnnounces(outcome)
              ? "The customer gets a short text inviting them to rebook."
              : "The customer is not texted - they cancelled it themselves."}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setOpen(false);
                run(() => reportStopOutcomeAction(shipment.id, outcome, note.trim()));
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </>
  );
}
