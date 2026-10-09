"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card, Button } from "@/components/ui";

/**
 * The employee surface's error boundary.
 *
 * Pages that read the database without a try/catch (/inventory, /invoices) used
 * to fall through to Next's unstyled "Application error: a server-side exception
 * has occurred" — the SAME face as the stale-`.next`-chunk trap documented in
 * CLAUDE.md, so a thirty-second Supabase blip sends someone hunting a build
 * problem that isn't there.
 *
 * Retry first, because that is what actually fixes the common case: `reset()`
 * re-renders the segment, which re-runs the server read.
 */
export default function EmployeeError({ error, reset }) {
  useEffect(() => {
    // The digest is the only handle on a prod stack trace, and Next strips the
    // message itself — so log both or the incident leaves no trace at all.
    console.error("Employee surface error:", error?.digest || error?.message || error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <AlertTriangle size={22} className="text-status-awaiting" />
          <h1 className="font-serif text-xl text-ink">This screen didn&apos;t load</h1>
          <p className="text-[13.5px] text-muted">
            Usually the database was briefly unreachable. Nothing you did was saved or lost — try
            again, and if it keeps failing, check the Supabase status before anything else.
          </p>
          <Button onClick={reset} size="sm" className="mt-1">
            <RotateCw size={15} /> Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
