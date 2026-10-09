"use client";

import { useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui";
import {
  SHEET_EXPORT_HEADERS,
  sheetExportRows,
  buildCsv,
  buildTsv,
  invoiceNumber,
} from "@/domain/inventory";

/**
 * The bridge to the buyer's Google Sheet: a CSV download and a clipboard TSV
 * of the invoice's devices, one row per lot, in EXACTLY the shared sheet's
 * column order (SHEET_EXPORT_HEADERS — that order is a contract; changing it
 * here means changing the sheet).
 *
 * On an unsettled invoice sheetExportRows falls back to `rate` for the price
 * column — which is precisely the asking-price sheet the buyer quotes
 * against. After settle the same export carries the actuals, so one button
 * serves both ends of the negotiation.
 */
export function BuyerExport({ invoice, lots }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const rows = sheetExportRows(lots);

  function downloadCsv() {
    const csv = buildCsv(SHEET_EXPORT_HEADERS, rows);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `invoice-${invoiceNumber(invoice.number)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyForSheets() {
    // TSV, not CSV: a clipboard paste lands one value per cell in Google
    // Sheets with no import dialog.
    navigator.clipboard?.writeText(buildTsv(SHEET_EXPORT_HEADERS, rows)).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!rows.length) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={downloadCsv}>
        <Download size={14} /> Export for buyer
      </Button>
      <Button variant="ghost" size="sm" onClick={copyForSheets}>
        {copied ? (
          <>
            <Check size={14} /> Copied {rows.length} row{rows.length === 1 ? "" : "s"}
          </>
        ) : (
          <>
            <Copy size={14} /> Copy for Sheets
          </>
        )}
      </Button>
    </>
  );
}
