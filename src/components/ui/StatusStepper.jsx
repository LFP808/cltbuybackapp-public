import { cn } from "@/lib/cn";
import { STAGES } from "@/domain/constants";

/**
 * Horizontal progress stepper through the shipment lifecycle. Shared by the
 * employee detail view and the customer portal, driven by the same STAGES
 * source (or a custom stage set for pickups via `stages`).
 */
export function StatusStepper({ status, stages = STAGES }) {
  const currentIndex = stages.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={stage.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                  done && "border-accent bg-accent text-white",
                  active && "border-accent bg-accent-l text-accent ring-4 ring-accent/10",
                  !done && !active && "border-line bg-white text-muted",
                )}
              >
                <Icon size={15} />
              </div>
              {/* Wraps on a phone, one line from `sm` up. Four nowrap labels
                  ("Awaiting Package" … "Payment Sent") cannot fit 360px, and
                  refusing to wrap makes them push the page sideways rather
                  than take a second line. */}
              <span
                className={cn(
                  "max-w-[4.5rem] text-center text-[10.5px] font-medium leading-tight sm:max-w-none sm:whitespace-nowrap",
                  active ? "font-semibold text-ink" : done ? "text-ink" : "text-muted",
                )}
              >
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className="mx-1.5 h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                <div
                  className={cn(
                    "h-full rounded-full bg-accent transition-all duration-500",
                    i < currentIndex ? "w-full" : "w-0",
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
