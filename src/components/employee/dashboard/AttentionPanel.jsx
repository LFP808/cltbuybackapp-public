import Link from "next/link";
import { AlertCircle, Clock, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import { URGENT } from "@/domain/attention";
import { cn } from "@/lib/cn";

/**
 * What the day owes you, above everything else on the dashboard.
 *
 * Every row here was already true somewhere — the check-in queue on
 * /inventory, follow-ups in the metrics, the call worklist — and being true on
 * five different screens is the same as being invisible. This is the one place
 * that answers "is there anything I have to deal with", so it sits at the top
 * and renders NOTHING at all when the answer is no. A permanent card reading
 * "0 items need attention" is a card people stop seeing, and then they stop
 * seeing it on the morning it says 3.
 */
export function AttentionPanel({ sections }) {
  if (!sections.length) return null;

  return (
    // `data-panel` is how scripts/attention-demo.mjs reads this card back. It
    // asserts that the panel and the digest agree line for line, which needs a
    // handle on THIS card rather than a text match that can land on any
    // enclosing div.
    <Card className="mb-5" data-panel="attention">
      <div className="mb-2.5 flex items-center gap-1.5">
        <AlertCircle size={14} className="text-accent" />
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted">
          Needs attention
        </h2>
      </div>

      <div className="divide-y divide-line">
        {sections.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className="group flex items-start gap-2.5 py-2.5 transition-colors hover:bg-paper"
          >
            <span
              className={cn(
                "mt-0.5 flex-shrink-0",
                s.severity === URGENT ? "text-red-500" : "text-muted",
              )}
            >
              {s.severity === URGENT ? <AlertCircle size={14} /> : <Clock size={14} />}
            </span>

            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[13.5px] font-semibold",
                  s.severity === URGENT ? "text-ink" : "text-ink",
                )}
              >
                {s.label}
              </span>
              <span className="block text-[12px] text-muted">{s.detail}</span>
              {/* Names, not just a count: "3 buys to check in" is a number,
                  "3 buys to check in - Ramirez, Chen, Okafor" is a decision
                  somebody can make without opening anything. */}
              <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                {s.items.map((i) => i.name).join(", ")}
                {s.more > 0 && ` +${s.more} more`}
              </span>
            </span>

            <ChevronRight
              size={14}
              className="mt-0.5 flex-shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>
    </Card>
  );
}
