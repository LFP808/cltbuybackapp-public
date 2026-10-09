import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { statusLabel, displayStage } from "@/domain/orders";

const badgeVariants = cva(
  "inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ring-transparent",
  {
    variants: {
      tone: {
        neutral: "bg-accent-l text-accent ring-accent/10",
        awaiting: "bg-status-awaiting-bg text-status-awaiting",
        received: "bg-status-received-bg text-status-received",
        // Paid is money that moved, so it wears the cash green — the one
        // green left in the palette, reserved for exactly this.
        paid: "bg-status-paid-bg text-status-paid ring-cash/10",
        // Terminal like paid, and deliberately colourless — a cancelled order
        // is not an outcome to celebrate. Needed as its own tone because cva
        // falls back to defaultVariants only for `undefined`, not for a value
        // it doesn't recognise, so this rendered as an unstyled pill.
        cancelled: "bg-bg text-muted ring-line",
        // Struck from the books by an admin. Reads as a warning, not as a
        // neutral record: anyone landing on this row should notice before
        // they quote it as history.
        deleted: "bg-destructive/10 text-destructive ring-destructive/20",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/**
 * Small pill for an order's status. statusLabel takes the order so a walk-in
 * reads in its own words ("Walked In") rather than the booked-meetup wording.
 */
export function StatusBadge({ order, className }) {
  const stage = displayStage(order);
  return (
    <span className={cn(badgeVariants({ tone: stage }), className)}>
      {statusLabel(stage, order)}
    </span>
  );
}

/** Neutral accent-tinted pill for arbitrary labels (carrier, tag, etc.). */
export function Badge({ className, children }) {
  return <span className={cn(badgeVariants({ tone: "neutral" }), className)}>{children}</span>;
}
