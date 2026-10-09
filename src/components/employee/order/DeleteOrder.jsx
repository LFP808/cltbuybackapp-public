"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Modal, DialogFooter } from "@/components/ui";
import { currency } from "@/domain/format";
import { deleteOrderAction } from "@/app/employee/actions";

/**
 * Strike an order from the books — the admin's button.
 *
 * Distinct from Cancel on purpose. Cancel is part of the order's life ("they
 * changed their mind"); delete says the order should not count at all: its
 * devices leave inventory and its payout leaves every money figure, while
 * the row stays as a record. The dialog says exactly that, in that order,
 * because somebody reading "Delete" expects the row to vanish and it won't.
 *
 * A reason is required, same as Cancel, and for the same reason: it is the
 * only explanation that will exist later.
 */
export function DeleteOrder({ shipment, busy, run }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const paid = shipment.status === "paid" && shipment.paidAmount != null;
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="text-destructive hover:border-destructive/40"
      >
        <Trash2 size={15} /> Delete order
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete this order?">
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            The record is kept — name, phone, items and the activity trail stay readable under the
            Deleted filter. Everything it counted for is removed:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>
              Its devices are removed from inventory
              {shipment.checkedInAt ? "" : " (none were checked in yet)"}.
            </li>
            <li>
              {paid
                ? `The ${currency(shipment.paidAmount)} payout no longer counts in cash flow or the dashboard.`
                : "It leaves the calendar, the check-in queue and every money figure."}
            </li>
            <li>Nothing is texted to the customer.</li>
          </ul>
          <p className="text-[12.5px] text-muted">
            If any of its devices are already on an invoice or sold, the delete is refused — void
            the invoice first so they return to stock.
          </p>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason, e.g. duplicate entry, test order, never happened"
            className="w-full rounded-lg border border-line px-2.5 py-2 text-[13px] outline-none focus:border-accent"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => {
                setOpen(false);
                run(() => deleteOrderAction(shipment.id, reason.trim()));
              }}
            >
              Delete order
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </>
  );
}
