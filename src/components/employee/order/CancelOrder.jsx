"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button, Modal, DialogFooter } from "@/components/ui";
import { cancelOrderAction } from "@/app/employee/actions";

/**
 * End an order with no money moving.
 *
 * A reason is required. "Cancelled" alone tells the next person nothing, and
 * the reason is what stops someone re-creating the same order next week.
 */
export function CancelOrder({ shipment, busy, run }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <XCircle size={15} /> Cancel order
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this order?">
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            It stops appearing in the pipeline and stops being chased for reminders. Nothing is
            texted to the customer — send them a note yourself if they need to know.
          </p>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason, e.g. customer changed their mind"
            className="w-full rounded-lg border border-line px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it open
            </Button>
            <Button
              disabled={busy || !reason.trim()}
              onClick={() => {
                setOpen(false);
                run(() => cancelOrderAction(shipment.id, reason.trim()));
              }}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </>
  );
}
