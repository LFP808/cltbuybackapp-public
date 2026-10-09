import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class-name composer used across the UI kit. clsx handles conditionals; the
 * tailwind-merge pass resolves conflicting Tailwind classes so later utilities
 * win (e.g. cn("p-2", "p-4") -> "p-4"). This is the shadcn convention.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
