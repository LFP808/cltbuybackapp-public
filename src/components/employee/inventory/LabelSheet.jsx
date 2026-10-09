import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card, PageTitle, EmptyState } from "@/components/ui";
import { barRuns } from "@/domain/barcode";
import { LABEL_WIDTH_IN, LABEL_HEIGHT_IN, MAX_LABELS } from "@/domain/labels";
import { PrintButton } from "@/components/employee/invoices/PrintButton";

/**
 * The 4 x 2 inch device labels, one per page, for a thermal label printer.
 *
 * The browser's print dialog IS the driver: `@page` sets the sheet to the
 * label stock, every label is its own page, and the print styles hide the
 * app shell and pin the sheet to the page origin so the label lands on the
 * label. A label printer on USB shows up as an ordinary printer with 4x2
 * stock; a phone-only model takes the same output as a saved PDF through its
 * own app. Nothing here is printer-specific beyond the size — any 4x2
 * thermal printer prints it.
 *
 * Server-rendered on purpose: the barcode is already a module bitmap from
 * domain/barcode.js, so the page is pure markup and prints identically with
 * JavaScript off.
 *
 * SIZING THE BARS. The SVG is drawn in module units and given a physical
 * width of four printer dots per module at 203 dpi (the printer's
 * resolution), capped at the label's inner width. A barcode whose module is
 * a whole number of dots prints with every bar the width it should be; one
 * scaled to "whatever fits" gets bars of 2 and 3 dots side by side, which is
 * the difference between a label that scans first time and one that
 * doesn't. Four dots (not two) because the bigger label has the room for a
 * thicker, easier-to-scan bar — the cap still protects a long identity from
 * overrunning the label.
 */

const DPI = 203;
const DOTS_PER_MODULE = 4;
// Inner width after the label's own padding (0.16in a side).
const INNER_WIDTH_IN = LABEL_WIDTH_IN - 0.32;

export function LabelSheet({
  labels,
  title = "Device labels",
  backHref = "/inventory",
  truncated,
}) {
  const noCode = labels.filter((l) => !l.barcode).length;
  return (
    <div className="label-page">
      <style>{LABEL_CSS}</style>

      {/* Screen chrome — the print styles hide all of it. */}
      <div className="print:hidden">
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1 text-[13px] font-bold text-accent"
        >
          <ChevronLeft size={16} /> Back
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle>{title}</PageTitle>
            <p className="mt-1 text-[13px] text-muted">
              {labels.length} label{labels.length === 1 ? "" : "s"} · {LABEL_WIDTH_IN} ×{" "}
              {LABEL_HEIGHT_IN} in, one per page
              {truncated ? ` · capped at ${MAX_LABELS} — print the rest as a second batch` : ""}
            </p>
          </div>
          {labels.length > 0 && <PrintButton />}
        </div>

        <Card className="mt-4 text-[13px] leading-relaxed text-muted">
          <p className="mb-1 font-semibold text-ink">Printing labels</p>
          In the print dialog pick the label printer, set paper size to{" "}
          <b className="text-ink">4 × 2 in (100 × 50 mm)</b>, margins{" "}
          <b className="text-ink">None</b>, scale <b className="text-ink">100%</b>, and turn headers
          and footers off. Each label is its own page. If your printer only pairs with a phone,
          choose <b className="text-ink">Save as PDF</b> here and print the PDF from its app. Scan
          the barcode straight into the IMEI field at check-in or the inventory search.
          {noCode > 0 && (
            <>
              {" "}
              <span className="text-status-awaiting">
                {noCode} label{noCode === 1 ? " has" : "s have"} no IMEI or serial recorded, so{" "}
                {noCode === 1 ? "it prints" : "they print"} text only.
              </span>
            </>
          )}
        </Card>
      </div>

      {labels.length === 0 ? (
        <div className="mt-4 print:hidden">
          <EmptyState
            title="Nothing to print"
            description="Tick devices on the Inventory grid and choose Print labels, or open an order that has been checked in."
          />
        </div>
      ) : (
        <div className="label-sheet mt-5">
          {labels.map((label) => (
            <DeviceLabel key={label.id} label={label} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceLabel({ label }) {
  const modules = label.barcode?.modules;
  const widthIn = modules
    ? Math.min((modules.length * DOTS_PER_MODULE) / DPI, INNER_WIDTH_IN)
    : null;
  return (
    <div className="label">
      <div className="label-top">
        <div className="label-device" title={label.device}>
          {label.device}
        </div>
        {label.condition && <div className="label-condition">{label.condition}</div>}
      </div>

      {modules ? (
        <svg
          className="label-code"
          viewBox={`0 0 ${modules.length} 1`}
          preserveAspectRatio="none"
          shapeRendering="crispEdges"
          style={{ width: `${widthIn.toFixed(3)}in` }}
          aria-label={`Barcode ${label.code}`}
        >
          {barRuns(modules).map(([x, w]) => (
            <rect key={x} x={x} y="0" width={w} height="1" fill="#000" />
          ))}
        </svg>
      ) : (
        <div className="label-nocode">
          {label.code ? "Can't encode this identity" : "No IMEI / serial"}
        </div>
      )}

      <div className="label-id">{label.code || "—"}</div>
      <div className="label-foot">
        <span>
          {label.codeKind === "serial" ? "Serial" : label.codeKind === "imei" ? "IMEI" : ""}
        </span>
        <span>
          {[label.condition ? `Cond. ${label.condition}` : "", label.carrier]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

/**
 * Plain CSS rather than Tailwind: the sizes are physical inches, the fonts
 * are deliberately generic (a thermal head renders a plain sans crisper than
 * a webfont it has to anti-alias), and the print block needs @page, which
 * Tailwind has no utility for.
 */
const LABEL_CSS = `
.label-sheet { display: flex; flex-wrap: wrap; gap: 12px; }
.label {
  box-sizing: border-box;
  width: ${LABEL_WIDTH_IN}in;
  height: ${LABEL_HEIGHT_IN}in;
  padding: 0.1in 0.16in 0.08in;
  background: #fff;
  color: #000;
  border: 1px solid #e7e8ec;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: Arial, Helvetica, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.label-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.12in; min-height: 0.4in; }
.label-device {
  flex: 1 1 auto; min-width: 0;
  font-size: 16pt; font-weight: 700; line-height: 1.1;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; text-overflow: ellipsis;
}
.label-condition {
  flex: 0 0 auto;
  font-size: 22pt; font-weight: 800; line-height: 1;
  padding: 0.04in 0.1in;
  border: 3px solid #000; border-radius: 6px;
  max-width: 1.5in; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.label-code { display: block; height: 0.74in; margin: 0.06in auto 0; }
.label-nocode { height: 0.74in; margin-top: 0.06in; display: flex; align-items: center; justify-content: center; font-size: 14pt; color: #000; border: 2px dashed #000; }
.label-id { margin-top: 0.03in; text-align: center; font-family: "IBM Plex Mono", Menlo, Consolas, monospace; font-size: 15pt; letter-spacing: 0.04em; line-height: 1.15; white-space: nowrap; overflow: hidden; }
.label-foot { display: flex; justify-content: space-between; gap: 0.12in; font-size: 12pt; line-height: 1.1; margin-top: auto; white-space: nowrap; overflow: hidden; }
@page { size: ${LABEL_WIDTH_IN}in ${LABEL_HEIGHT_IN}in; margin: 0; }
@media print {
  /* Only the sheet prints: everything else is hidden (not removed, so the
     sheet's own layout is untouched) and the sheet is pinned to the page
     origin, out from under the shell's padding and sidebar margin. The
     shell drops its padding and its enter animation under print: (see
     EmployeeShell) — the animation's transform would otherwise make the
     wrapper the containing block and this absolute offset would land
     inside it. */
  body * { visibility: hidden; }
  .label-sheet, .label-sheet * { visibility: visible; }
  .label-sheet { position: absolute; left: 0; top: 0; margin: 0; padding: 0; display: block; }
  .label { border: none; border-radius: 0; page-break-after: always; break-after: page; }
  .label:last-child { page-break-after: auto; break-after: auto; }
}
`;
