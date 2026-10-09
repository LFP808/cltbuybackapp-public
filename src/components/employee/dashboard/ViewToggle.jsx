import Link from "next/link";
import { LayoutList, BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Segmented control switching the dashboard between the operational order list
 * and the admin metrics overview. Server-rendered from the active view.
 *
 * The key stays "shipments" — it is matched against a value the page computes,
 * not shown to anyone, and renaming it buys nothing.
 */
export function ViewToggle({ active }) {
  const tabs = [
    { key: "shipments", label: "Orders", href: "/", icon: LayoutList },
    { key: "overview", label: "Overview", href: "/?view=overview", icon: BarChart3 },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-0.5 shadow-xs">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              on ? "bg-accent text-white shadow-xs" : "text-muted hover:text-ink",
            )}
          >
            <Icon size={14} /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
