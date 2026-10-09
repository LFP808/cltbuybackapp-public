import { cn } from "@/lib/cn";

/**
 * Surface primitive. Keeps the original single-container API (used everywhere
 * as <Card className="…">…</Card>) but with a softer enterprise look: hairline
 * border, layered shadow, larger radius. Optional sub-parts are exported for
 * structured cards.
 */
export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn("rounded-card border border-line/80 bg-white p-5 shadow-card", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn("mb-3 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn("font-serif text-base text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("text-[13px] text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn(className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn("mt-4 flex items-center gap-2", className)} {...props} />;
}

/** Empty-state block used inside cards/lists. */
export function EmptyState({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-muted">
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-l/60 text-accent">
          <Icon size={18} />
        </div>
      )}
      <p className="text-[13.5px]">{children}</p>
    </div>
  );
}
