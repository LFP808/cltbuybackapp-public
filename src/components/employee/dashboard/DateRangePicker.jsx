"use client";

import { RANGES } from "@/domain/date-range";
import { cn } from "@/lib/cn";

/**
 * The date-range control, shared by the overview and the orders list.
 *
 * Controlled: the caller owns the selection and decides what to do with it —
 * the overview writes it to the URL, the orders list keeps it in state. This
 * component only knows how to present the choice.
 *
 * `allow` narrows the presets, because they are not all meaningful everywhere.
 * The overview measures what happened, so "Upcoming" would always be empty
 * there; the orders list is looking at scheduled work, so it is the useful one.
 */
export function DateRangePicker({
  value,
  onChange,
  from = "",
  to = "",
  onFromChange,
  onToChange,
  allow,
}) {
  const options = allow ? RANGES.filter((r) => allow.includes(r.key)) : RANGES;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            aria-pressed={value === r.key}
            className={cn(
              "rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
              value === r.key
                ? "border-accent bg-accent-l text-accent"
                : "border-line bg-white text-ink hover:border-accent/40",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {value === "custom" && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => onFromChange?.(e.target.value)}
              className="h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => onToChange?.(e.target.value)}
              className="h-9 rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
            />
          </label>
        </div>
      )}
    </div>
  );
}
