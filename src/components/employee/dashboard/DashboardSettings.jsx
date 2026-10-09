"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Settings2, Calendar, Check } from "lucide-react";
import { Modal, Button, DialogFooter } from "@/components/ui";
import { DateRangePicker } from "./DateRangePicker";
import { cn } from "@/lib/cn";

/** The overview measures what has happened, so it offers no future range. */
const OVERVIEW_RANGES = ["month", "30d", "90d", "ytd", "all", "custom"];

export const SECTIONS = [
  { key: "pipeline", label: "Order pipeline" },
  { key: "trend", label: "Orders per week" },
  { key: "top", label: "Top customers" },
  { key: "methods", label: "Payout by method" },
  { key: "mix", label: "Order mix" },
];

/**
 * Overview controls: a chip showing the active date range and a gear button
 * that opens a settings modal to change the range (presets or a custom
 * from/to) and toggle which sections are visible. All state lives in the URL
 * (?range / ?from / ?to / ?hide), so the view is server-rendered and shareable.
 */
export function DashboardSettings({ rangeKey, rangeLabel, from, to, hidden = [] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [range, setRange] = useState(rangeKey || "all");
  const [customFrom, setCustomFrom] = useState(from || "");
  const [customTo, setCustomTo] = useState(to || "");
  const [visible, setVisible] = useState(
    Object.fromEntries(SECTIONS.map((s) => [s.key, !hidden.includes(s.key)])),
  );

  function apply() {
    const params = new URLSearchParams();
    params.set("view", "overview");

    if (range === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    } else if (range !== "all") {
      params.set("range", range);
    }

    const hide = SECTIONS.filter((s) => !visible[s.key]).map((s) => s.key);
    if (hide.length) params.set("hide", hide.join(","));

    setOpen(false);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium capitalize text-ink shadow-xs">
        <Calendar size={13} className="text-accent" />
        {rangeLabel}
      </span>
      <button
        onClick={() => setOpen(true)}
        aria-label="Dashboard settings"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white text-muted shadow-xs transition-colors hover:border-accent/40 hover:text-accent"
      >
        <Settings2 size={16} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Dashboard settings">
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Date range
            </div>
            <DateRangePicker
              value={range}
              onChange={setRange}
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
              allow={OVERVIEW_RANGES}
            />
          </div>

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              Visible sections
            </div>
            <div className="space-y-1.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-bg"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                      visible[s.key] ? "border-accent bg-accent text-white" : "border-line bg-white",
                    )}
                  >
                    {visible[s.key] && <Check size={12} />}
                  </span>
                  <span className="text-[13.5px] text-ink">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply</Button>
          </DialogFooter>
        </div>
      </Modal>
    </div>
  );
}
