"use client";

import { MessageSquare, AlertTriangle } from "lucide-react";
import { Modal, Button, DialogFooter } from "@/components/ui";

/**
 * Confirm an action that texts the customer, showing the exact words first.
 *
 * These buttons used to fire immediately. "Send payment" is one click from
 * telling someone their money is on the way, and a text cannot be unsent — a
 * misclick is a phone call from a customer asking where their payment is.
 *
 * IT SHOWS THE MESSAGE, not just a warning. "Are you sure?" teaches people to
 * click through; the actual sentence the customer will read is worth pausing
 * for, and it doubles as a proofread of the templates.
 *
 * @param {{
 *   open: boolean, onClose: () => void, onConfirm: () => void,
 *   title: string, confirmLabel: string, message?: string,
 *   phone?: string, busy?: boolean, testMode?: boolean, children?: React.ReactNode
 * }} props
 */
export function ConfirmSend({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  message,
  phone,
  busy = false,
  testMode = false,
  children,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        {children}

        {message ? (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
              <MessageSquare size={11} />
              {phone ? `Text to ${phone}` : "Text to the customer"}
            </div>
            {/* The bubble is styled like the thread on purpose: what you approve
                here is what appears there. */}
            <p className="whitespace-pre-wrap rounded-[14px] bg-accent-l px-3.5 py-2.5 text-[13px] leading-snug text-accent-dark">
              {message}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-muted">No text will be sent for this.</p>
        )}

        {testMode && message && (
          <p className="flex items-start gap-1.5 rounded-lg bg-status-awaiting-bg px-2.5 py-2 text-[12px] text-status-awaiting">
            <AlertTriangle size={13} className="mt-px flex-shrink-0" />
            Test mode is on, so this is logged to the conversation but not actually delivered.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </div>
    </Modal>
  );
}
