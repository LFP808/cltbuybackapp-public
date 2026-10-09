import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** shadcn-style breadcrumb primitives. Compose with BreadcrumbAuto in the shell. */
export function Breadcrumb({ className, ...props }) {
  return <nav aria-label="Breadcrumb" className={className} {...props} />;
}

export function BreadcrumbList({ className, ...props }) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-1.5 text-[12.5px]", className)} {...props} />
  );
}

export function BreadcrumbItem({ className, ...props }) {
  return <li className={cn("inline-flex items-center gap-1.5", className)} {...props} />;
}

export function BreadcrumbLink({ className, ...props }) {
  return (
    <Link
      className={cn("font-medium text-muted transition-colors hover:text-accent", className)}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }) {
  return <span className={cn("font-semibold text-ink", className)} {...props} />;
}

export function BreadcrumbSeparator({ className }) {
  return <ChevronRight size={13} className={cn("text-muted/60", className)} />;
}
