import { cn } from "@/lib/cn";

/** Monospace span for IMEIs and other data. */
export function Mono({ className, children }) {
  return <span className={cn("font-mono", className)}>{children}</span>;
}

/** Small uppercase section heading used above list groups. */
export function SectionLabel({ icon: Icon, className, children }) {
  return (
    <div
      className={cn(
        "mb-2.5 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted",
        className,
      )}
    >
      {Icon && <Icon size={13} className="text-accent" />}
      {children}
    </div>
  );
}

/** Page title in the brand serif. */
export function PageTitle({ className, children }) {
  return (
    <h1 className={cn("font-serif text-[26px] tracking-tight text-ink", className)}>
      {children}
    </h1>
  );
}
