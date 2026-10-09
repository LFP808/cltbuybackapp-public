"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** shadcn-style dialog built on Radix — focus trap, scrim, enter/exit motion. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[101] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-white p-6 shadow-pop",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-top-1",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute right-4 top-4 rounded-md p-1 text-muted outline-none ring-offset-white transition-colors hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label="Close"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn("mb-4 flex flex-col gap-1 pr-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      className={cn("font-serif text-lg text-ink", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description className={cn("text-[13px] text-muted", className)} {...props} />
  );
}

/**
 * The action row at the bottom of a modal: right-aligned buttons above a
 * hairline. This IS the house style — it was hand-rolled, nearly identically,
 * in eight modals before anything used this component, so the definition now
 * matches what the app actually looks like rather than the shadcn default it
 * shipped with (mt-5, no rule). No top margin on purpose: every modal body
 * spaces its children with space-y-*, and a margin here would double it.
 */
export function DialogFooter({ className, ...props }) {
  return (
    <div className={cn("flex justify-end gap-2 border-t border-line pt-3", className)} {...props} />
  );
}
