"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Top-center snackbar: confirmation that must not interrupt. Slides in from
 * the top of the VIEWPORT (portalled to <body> — a transformed or sticky
 * ancestor would otherwise pin "fixed" to itself), no backdrop, the page
 * stays interactive: its job is "that worked, here is what you got" while
 * the person is already switching to wherever they need the result.
 *
 * Auto-dismisses after `duration`; hovering pauses the clock (reading is the
 * point) and leaving re-arms it in full. Pass a changing `key` to restart
 * the timer for repeat fires of the same toast — remounting is simpler and
 * more honest than a nonce prop threaded into the effect.
 *
 * The slide respects prefers-reduced-motion via the animate-toast-in class
 * (globals.css swaps the keyframes for a plain fade).
 *
 * First consumer is the slot picker's "Copy times for lead"; the export
 * buttons' "Copied N rows" confirmations could adopt it later.
 */
export function Toast({
  open,
  onClose,
  duration = 6000,
  icon: Icon = CheckCircle2,
  title,
  children,
  className,
}) {
  // Portals need a browser; render nothing during SSR/hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const timer = useRef(null);
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onClose?.(), duration);
  };
  useEffect(() => {
    if (!open) return undefined;
    arm();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration]);

  if (!mounted || !open) return null;
  return createPortal(
    // The wrapper centers; the CARD animates — the entrance keyframes own
    // `transform`, so -translate-x-1/2 centering could not live on the same
    // element without being overwritten mid-animation.
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4 print:hidden">
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => clearTimeout(timer.current)}
        onMouseLeave={arm}
        className={cn(
          "pointer-events-auto w-full max-w-[26rem] animate-toast-in rounded-card border border-line bg-white p-3.5 shadow-pop",
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          {Icon && <Icon size={16} className="mt-0.5 flex-shrink-0 text-accent" />}
          <div className="min-w-0 flex-1">
            {title && <div className="text-[13px] font-semibold text-ink">{title}</div>}
            {children}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="-m-1 rounded-md p-1 text-muted hover:bg-bg hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
