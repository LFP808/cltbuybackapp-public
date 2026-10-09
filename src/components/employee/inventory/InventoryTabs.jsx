"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { PendingCheckins } from "./PendingCheckins";
import { InventoryGrid } from "./InventoryGrid";

/**
 * The two-tab shell. Both tabs' data arrive server-fetched; switching is
 * instant client state, and the queue count on the tab is the same number the
 * queue renders — one source, no drift.
 */
export function InventoryTabs({
  queue,
  lots,
  grades,
  truncated,
  canEdit = true,
  canCheckIn = true,
  isAdmin = false,
}) {
  // A VA can't check anything in, so the queue is not their work — open on the
  // grid, which is what they came for. Still shown (knowing what is waiting to
  // be counted is useful on a call), just not first.
  const [tab, setTab] = useState(queue.length && canCheckIn ? "pending" : "grid");

  return (
    <div>
      <div className="mb-4 flex items-center gap-1 border-b border-line">
        <TabButton active={tab === "pending"} onClick={() => setTab("pending")}>
          Pending Check-in
          {queue.length > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10.5px] font-bold text-white">
              {queue.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "grid"} onClick={() => setTab("grid")}>
          Inventory
        </TabButton>
      </div>

      {tab === "pending" ? (
        <PendingCheckins queue={queue} canCheckIn={canCheckIn} />
      ) : (
        <InventoryGrid
          lots={lots}
          grades={grades}
          truncated={truncated}
          canEdit={canEdit}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-semibold transition-colors",
        active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
