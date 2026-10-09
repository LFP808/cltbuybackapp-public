"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./Dialog";

/**
 * Backwards-compatible Modal API (open / onClose / title) implemented on top of
 * the Radix Dialog, so existing callers get focus trapping and motion for free
 * without any changes.
 */
export function Modal({ open, onClose, title, children, className }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className={className}>
        {title && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
