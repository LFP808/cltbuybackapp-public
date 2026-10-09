import { cn } from "@/lib/cn";

/** Loading placeholder with a soft pulse. */
export function Skeleton({ className }) {
  return <div className={cn("animate-pulse rounded-md bg-line/70", className)} />;
}
