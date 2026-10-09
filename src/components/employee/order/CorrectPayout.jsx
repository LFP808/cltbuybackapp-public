"use client";

import { useState } from "react";
import { Button, Modal, DialogFooter } from "@/components/ui";
import { currency } from "@/domain/format";
import { correctPayoutAction } from "@/app/employee/actions";

export function CorrectPayout({ shipment, busy, run, suggestedAmount, suggestedReason }) {
  const [open, setOpen] = useState(false);
  // Seeded from the check-in gap when one exists — the counted total is the
  // obvious correction — and from the recorded payout otherwise.
  const [amount, setAmount] = useState(String(suggestedAmount ?? shipment.paidAmount ?? ""));
  const [reason, setReason] = useState(suggestedReason ?? "");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-[12px] font-semibold text-accent underline"
      >
        Correct this amount
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Correct the payout">
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">
            Recorded as {currency(shipment.paidAmount)}. Correcting it changes the dashboard totals
            and is written to the activity log. The customer is not re-texted.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 rounded-lg border border-line px-3 py-2 text-[13px]"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why it changed"
              className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-2 text-[13px] outline-none focus:border-accent"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !amount || !reason.trim()}
              onClick={() => {
                setOpen(false);
                run(() => correctPayoutAction(shipment.id, Number(amount), reason.trim()));
              }}
            >
              Save correction
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </>
  );
}
