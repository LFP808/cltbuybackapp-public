"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** The browser's own print dialog is the PDF export — nothing to maintain. */
export function PrintButton() {
  return (
    <Button variant="ghost" size="sm" onClick={() => window.print()}>
      <Printer size={14} /> Print / save PDF
    </Button>
  );
}
