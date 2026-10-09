import { cn } from "@/lib/cn";

/**
 * Initials avatar. Simple, dependency-free (the app only ever shows initials),
 * with size and tone options for the sidebar user chip and conversation lists.
 */
export function Avatar({ initial, size = "md", tone = "accent", className }) {
  const sizes = {
    sm: "h-8 w-8 text-[13px]",
    md: "h-9 w-9 text-sm",
    lg: "h-11 w-11 text-base",
  };
  const tones = {
    accent: "bg-accent text-white",
    soft: "bg-accent-l text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex flex-shrink-0 items-center justify-center rounded-full font-serif",
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {initial}
    </span>
  );
}
