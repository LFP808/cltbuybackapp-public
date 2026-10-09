import { cn } from "@/lib/cn";

/**
 * Minimal loading ring: a hairline circle with one brand-accent arc.
 *
 * @param {{ size?: number, className?: string, label?: string }} props
 */
export function Spinner({ size = 26, className, label = "Loading" }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-line border-t-accent",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Centred loading state for a route transition.
 *
 * Deliberately invisible for the first fraction of a second. Most navigations
 * here resolve almost instantly, and a spinner that flashes on every one reads
 * as jank rather than feedback — so the fade-in is delayed, and only a
 * transition that genuinely lags ever shows it.
 *
 * Sized to fill the content area rather than the viewport: the sidebar and
 * header persist across navigation, so covering them would be a lie about what
 * is actually loading.
 */
export function RouteSpinner({ label = "Loading" }) {
  return (
    <div className="flex min-h-[55vh] w-full items-center justify-center">
      {/* The fade lives on a wrapper, not the ring: both are `animation`
          shorthand, so putting them on one element would clobber the spin. */}
      <span className="animate-delayed-in">
        <Spinner label={label} />
      </span>
    </div>
  );
}
