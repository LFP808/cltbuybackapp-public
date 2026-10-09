import { cn } from "@/lib/cn";

/** The "CLT" monogram mark. */
export function Brandmark({ className, large = false }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg bg-accent font-serif tracking-wide text-white shadow-xs",
        large ? "h-11 px-3 text-base" : "h-8 px-2.5 text-[13px]",
        className,
      )}
    >
      CLT
    </span>
  );
}

/** Full brand lockup (mark + wordmark) for the light sidebar header. */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <Brandmark />
      <div className="text-[12px] font-bold leading-tight text-ink">
        CLT
        <br />
        Buyback
        <span className="block text-[10.5px] font-semibold tracking-[0.14em] text-accent">
          CHARLOTTE
        </span>
      </div>
    </div>
  );
}
