import { CalendarCheck, Store } from "lucide-react";

/**
 * The meetup / walk-in flair on a customer.
 *
 * The word carries the detail; the icon says it a second time for a scan of
 * forty names. "Do I book this person in, or do they just turn up?" is the
 * question this answers before anyone opens the row.
 *
 * Deliberately NOT the generic <Badge>: tags are things a person typed and
 * this is something the app worked out, and a derived fact that looks exactly
 * like an entered one invites somebody to try to edit it.
 */
const STYLES = {
  walk_in: { className: "bg-accent-l text-accent-dark", Icon: Store },
  meetup: { className: "bg-accent-l text-accent-dark", Icon: CalendarCheck },
  mixed: { className: "bg-accent-l text-accent-dark", Icon: Store },
};

export function KindFlair({ kind, title }) {
  const style = STYLES[kind?.key];
  // "none" — a contact with no orders. Nothing has happened yet, and guessing
  // is worse than saying nothing.
  if (!style || !kind?.label) return null;
  const { className, Icon } = style;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10.5px] font-semibold ${className}`}
    >
      <Icon size={11} />
      {kind.label}
    </span>
  );
}
