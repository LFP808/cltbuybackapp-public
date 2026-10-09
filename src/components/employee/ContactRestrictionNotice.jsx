import { BellOff, Ban, AlertTriangle } from "lucide-react";
import { contactRestriction } from "@/domain/contact-status";
import { cn } from "@/lib/cn";

/**
 * Says why a message might not land, wherever one can be typed.
 *
 * Rendered ABOVE the composer rather than replacing it for the reminder case:
 * PAUSE only stops the automated chasing, so taking the box away would be
 * wrong. A carrier block is different — nothing gets through, so there the
 * caller hides the composer entirely and shows this in its place.
 */
export function ContactRestrictionNotice({ contact, className }) {
  const restriction = contactRestriction(contact);
  if (!restriction) return null;

  const blocked = restriction.kind === "blocked";
  // "unknown" is a warning, not a refusal: the customer may be perfectly
  // reachable, we just couldn't confirm it, so it reads amber rather than red.
  const unknown = restriction.kind === "unknown";
  const Icon = blocked ? Ban : unknown ? AlertTriangle : BellOff;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12px]",
        blocked
          ? "bg-red-50 text-red-600"
          : unknown
            ? "bg-status-awaiting-bg text-status-awaiting"
            : "bg-bg text-muted",
        className,
      )}
    >
      <Icon size={13} className="mt-px flex-shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold">{restriction.title}</span> {restriction.detail}
      </span>
    </div>
  );
}
