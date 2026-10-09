import { cn } from "@/lib/cn";

/** Labeled text input, shadcn-styled. Forwards all native <input> props. */
export function Input({ label, hint, error, className, id, ...props }) {
  const inputId = id || props.name;
  return (
    <label className="flex flex-col gap-1.5" htmlFor={inputId}>
      {label && <span className="text-[13px] font-medium text-ink">{label}</span>}
      <input
        id={inputId}
        className={cn(
          "h-9 w-full rounded-lg border border-line bg-white px-3 text-[14px] text-ink shadow-xs outline-none placeholder:text-muted/70",
          "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error &&
            "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="text-[12px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
