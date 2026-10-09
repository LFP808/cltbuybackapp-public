"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown, Download, Copy, Printer } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { currency } from "@/domain/format";
import { resolveRange, inRange, labelFor } from "@/domain/date-range";
import { DateRangePicker } from "@/components/employee/dashboard/DateRangePicker";
import {
  LOT_STATUS_LABELS,
  lotCogTotal,
  lotInvoiceTotal,
  lotPL,
  lotSourceLabel,
  invoiceNumber,
  buildCsv,
  buildTsv,
  sheetCopyRows,
  isDirectSale,
} from "@/domain/inventory";
import { LotEditDialog } from "./LotEditDialog";

/**
 * The sheet, as a page: one row per device, its whole life in the columns —
 * status, date, IMEI, item, carrier, grade, COG, buyer, invoice, sold,
 * shipping, P/L, source, paid-via. Google-Sheets manners on purpose: filters
 * live IN the column headers with options scoped to what's visible, every
 * column sorts from the same menu, the stat tiles recompute from the filtered
 * rows, and ⬇ CSV exports exactly what's on screen.
 *
 * Read-and-track only: the money actions (invoice, settle) live on the
 * Invoices page. The only writes reachable from here are fixing an in-stock
 * lot's facts and disposing one — click the row.
 */

const RANGE_KEYS = ["month", "30d", "90d", "ytd", "all", "custom"];

// One row per physical device (the check-in expands quantities), so there is
// no Qty column — the sheet's grain, kept on purpose.
const COLUMNS = [
  { key: "status", label: "Status", filter: true, sort: true },
  { key: "date", label: "Date", sort: true },
  { key: "imei", label: "IMEI", sort: true },
  { key: "type", label: "Item", filter: true, sort: true },
  { key: "carrier", label: "Carrier", filter: true, sort: true },
  { key: "grade", label: "Grade", filter: true, sort: true },
  // Who did the buy — the axis per-person P/L slices on, so it filters.
  { key: "boughtBy", label: "Bought by", filter: true, sort: true },
  { key: "cog", label: "COG", money: true, sort: true },
  { key: "buyer", label: "Buyer", filter: true, sort: true },
  { key: "invoice", label: "Invoice", money: true, sort: true },
  { key: "sold", label: "Sold", money: true, sort: true },
  { key: "ship", label: "Ship", money: true },
  // Marketplace (eBay) fees on direct sales; blank on wholesale rows.
  { key: "fee", label: "Fees", money: true },
  { key: "pl", label: "P/L", money: true, sort: true },
  { key: "source", label: "Source", filter: true },
  { key: "paidVia", label: "Paid via", filter: true },
];

const STATUS_TONES = {
  in_stock: "bg-accent-l text-accent",
  shipped: "bg-status-sent-bg text-status-sent",
  complete: "bg-status-paid-bg text-status-paid",
  disposed: "bg-bg text-muted ring-1 ring-inset ring-line",
};

export function InventoryGrid({ lots, grades, truncated, canEdit = true, isAdmin = false }) {
  const [rangeKey, setRangeKey] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState(null); // { key, dir }
  const [menu, setMenu] = useState(null); // open header key
  const [editing, setEditing] = useState(null); // lot being edited
  const [selected, setSelected] = useState(() => new Set()); // lot ids ticked for export
  // "Copied N rows" flash after Copy for Sheets; -1 means the copy failed.
  const [copied, setCopied] = useState(null);

  // A selection outlives the view that made it only as a footgun: tick five
  // rows, change a filter, and "Export" would quietly ship devices no longer
  // on screen. Any change to what's visible drops the selection. (Sort only
  // reorders — nothing appears or disappears — so it keeps it.)
  useEffect(() => {
    setSelected(new Set());
    setCopied(null);
  }, [rangeKey, customFrom, customTo, query, filters]);

  const range = useMemo(
    () => resolveRange({ range: rangeKey, from: customFrom, to: customTo }),
    [rangeKey, customFrom, customTo],
  );

  // One derived row per lot; every column reads from here so the grid, the
  // tiles, and the CSV can never disagree.
  const rows = useMemo(
    () =>
      lots.map((lot) => {
        return {
          lot,
          status: LOT_STATUS_LABELS[lot.status] || lot.status,
          date: lot.createdAt,
          type: lot.item,
          qty: lot.quantity,
          imei: lot.imei ?? "",
          serial: lot.serial ?? "",
          carrier: lot.carrier ?? "",
          grade: lot.grade ?? "",
          // "Unrecorded" rather than an em dash: the filter menu hides "—" as
          // "nothing here", and pre-column lots are the one group that most
          // needs to be selectable.
          boughtBy: lot.boughtBy || "Unrecorded",
          cog: lotCogTotal(lot),
          // A direct sale has no buyer record; the channel is the buyer-shaped
          // fact worth showing (and filtering) in its place.
          buyer: lot.invoice?.buyerName ?? lot.soldChannel ?? "",
          invoice: lotInvoiceTotal(lot),
          invoiceNo: lot.invoice?.number,
          sold: lot.soldTotal ?? null,
          ship: lot.shipTotal ?? null,
          fee: lot.feeTotal ?? null,
          pl: lotPL(lot),
          source: lotSourceLabel(lot.order),
          paidVia: lot.order?.paymentMethod ?? "",
          customer: lot.order?.name ?? "",
        };
      }),
    [lots],
  );

  /** Does a row pass everything EXCEPT the named column's own filter? */
  function passes(row, exceptKey) {
    if (!inRange(row.date, range)) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay =
        `${row.type} ${row.buyer} ${row.customer} ${row.imei} ${row.serial} ${row.carrier} ${row.grade} ${row.status} ${row.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const [key, value] of Object.entries(filters)) {
      if (key === exceptKey || !value) continue;
      if (String(row[key] || "—") !== value) return false;
    }
    return true;
  }

  const visible = useMemo(() => {
    const out = rows.filter((row) => passes(row));
    if (sort) {
      const { key, dir } = sort;
      out.sort((a, b) => {
        const va = sortValue(a, key);
        const vb = sortValue(b, key);
        const na = va != null && va !== "";
        const nb = vb != null && vb !== "";
        // Empty values sink to the bottom in either direction.
        if (na !== nb) return na ? -1 : 1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, range, query, filters, sort]);

  // The tiles ARE the grid: filter to a buyer and they become that buyer's
  // books; widen to all time and they're the running totals.
  const tiles = useMemo(() => {
    let stockCog = 0;
    let stockUnits = 0;
    let sold = 0;
    let soldRows = 0;
    let pl = 0;
    for (const row of visible) {
      if (row.lot.status === "in_stock") {
        stockCog += row.cog;
        stockUnits += row.qty;
      }
      if (row.sold != null) {
        sold += row.sold;
        soldRows += 1;
      }
      if (row.pl != null) pl += row.pl;
    }
    return { stockCog, stockUnits, sold, soldRows, pl };
  }, [visible]);

  function optionsFor(key) {
    const seen = new Set();
    for (const row of rows) {
      if (!passes(row, key)) continue;
      const value = String(row[key] || "—");
      if (value !== "—") seen.add(value);
    }
    // numeric:true keeps "iPhone 2" ahead of "iPhone 10" in the menus.
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  // The ticked rows in on-screen order — what the eye checked is what exports.
  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.lot.id)),
    [visible, selected],
  );
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.lot.id));

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCopied(null);
  }

  /** Header checkbox: everything currently visible, or nothing. */
  function toggleAllVisible() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.lot.id)));
    setCopied(null);
  }

  // Both selected-row exports emit EXACTLY sheetCopyRows, no headers — that
  // shape (Inventory, Date, IMEI, Items, Carrier, Grade, Payment Method,
  // COG) is a contract with the buy-log sheet's own columns. The BUYER sheet
  // is a different contract and keeps sheetExportRows (see
  // invoices/BuyerExport). Add columns in the domain, not here.
  function exportSelectedCsv() {
    const rows = sheetCopyRows(selectedRows.map((r) => r.lot));
    const csv = buildCsv(null, rows);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `cltbb-export-${dateStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyForSheets() {
    const rows = sheetCopyRows(selectedRows.map((r) => r.lot));
    const tsv = buildTsv(null, rows);
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(selectedRows.length);
    } catch {
      // Clipboard needs a secure context and permission; the CSV download
      // beside this button is the fallback, so just say it failed.
      setCopied(-1);
    }
    setTimeout(() => setCopied(null), 4000);
  }

  function exportCsv() {
    const csv = buildCsv(
      [
        "Status",
        "Date",
        "Customer",
        "IMEI",
        "Serial",
        "Item",
        "Carrier",
        "Grade",
        "Bought by",
        "COG",
        "Buyer",
        "Invoice #",
        "Invoice",
        "Sold",
        "Ship",
        "Fees",
        "P/L",
        "Source",
        "Paid via",
      ],
      visible.map((row) => [
        row.status,
        new Date(row.date).toLocaleDateString(),
        row.customer,
        row.imei,
        row.serial,
        row.type,
        row.carrier,
        row.grade,
        row.lot.boughtBy ?? "",
        row.cog.toFixed(2),
        row.buyer,
        row.invoiceNo != null ? invoiceNumber(row.invoiceNo) : "",
        row.invoice != null ? row.invoice.toFixed(2) : "",
        row.sold != null ? row.sold.toFixed(2) : "",
        row.ship != null ? row.ship.toFixed(2) : "",
        row.fee != null ? row.fee.toFixed(2) : "",
        row.pl != null ? row.pl.toFixed(2) : "",
        row.source,
        row.paidVia,
      ]),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "inventory.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      {/* Toolbar: search, range, export. Filters live in the headers below. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items, IMEIs, buyers, customers…"
            className="h-9 w-full rounded-lg border border-line bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent"
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setRangeOpen((o) => !o)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-l px-3 text-[12.5px] font-semibold text-accent"
          >
            {range.label || labelFor(rangeKey)} <ChevronDown size={13} />
          </button>
          {rangeOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setRangeOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-line bg-white p-3 shadow-pop">
                <DateRangePicker
                  value={rangeKey}
                  onChange={(key) => {
                    setRangeKey(key);
                    if (key !== "custom") setRangeOpen(false);
                  }}
                  from={customFrom}
                  to={customTo}
                  onFromChange={setCustomFrom}
                  onToChange={setCustomTo}
                  allow={RANGE_KEYS}
                />
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-bg"
        >
          <Download size={13} /> CSV
        </button>
      </div>

      {/* The tiles recompute from whatever the grid currently shows. */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Tile
          label="On hand · COG"
          value={currency(tiles.stockCog)}
          sub={`${tiles.stockUnits} unit${tiles.stockUnits === 1 ? "" : "s"}`}
        />
        <Tile
          label="Sold"
          value={currency(tiles.sold)}
          sub={`${tiles.soldRows} row${tiles.soldRows === 1 ? "" : "s"} settled`}
        />
        <Tile
          label="P/L"
          value={(tiles.pl > 0 ? "+" : "") + currency(tiles.pl)}
          sub="incl. disposals"
          tone={tiles.pl < 0 ? "text-destructive" : "text-cash"}
        />
      </div>

      {/* The selection toolbar — only exists while something is ticked, so it
          never competes with the filters for attention. */}
      {selectedRows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card bg-accent-l px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-accent">
            {selectedRows.length} device{selectedRows.length === 1 ? "" : "s"} selected
            <span className="font-normal"> — exports the shared-sheet columns</span>
          </p>
          {copied != null && (
            <span
              className={cn(
                "text-[12px] font-semibold",
                copied === -1 ? "text-destructive" : "text-accent",
              )}
            >
              {copied === -1
                ? "Couldn't copy — use Export CSV"
                : `Copied ${copied} row${copied === 1 ? "" : "s"}`}
            </span>
          )}
          <button
            type="button"
            onClick={exportSelectedCsv}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-accent ring-1 ring-inset ring-accent/30 hover:bg-bg"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            type="button"
            onClick={copyForSheets}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-accent ring-1 ring-inset ring-accent/30 hover:bg-bg"
          >
            <Copy size={13} /> Copy for Sheets
          </button>
          {/* The 4x2 device labels for the ticked rows, in on-screen order.
              A plain link in a new tab: the sheet is its own page, and the
              selection here survives for the next export. */}
          <a
            href={`/inventory/labels?ids=${selectedRows.map((row) => row.lot.id).join(",")}`}
            target="_blank"
            rel="noopener"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-accent ring-1 ring-inset ring-accent/30 hover:bg-bg"
          >
            <Printer size={13} /> Print labels
          </a>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="h-8 rounded-lg px-2 text-[12.5px] font-semibold text-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No inventory yet"
          description="Lots appear here as orders are checked in."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1060px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                <th className="w-9 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="h-3.5 w-3.5 accent-accent align-middle"
                  />
                </th>
                {COLUMNS.map((col) => (
                  <HeaderCell
                    key={col.key}
                    col={col}
                    filters={filters}
                    setFilters={setFilters}
                    sort={sort}
                    setSort={setSort}
                    menu={menu}
                    setMenu={setMenu}
                    optionsFor={optionsFor}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.lot.id}
                  onClick={() =>
                    canEdit &&
                    // In-stock rows open the fact editor; a direct (eBay) sale
                    // opens its sale summary + undo. Invoiced rows stay locked.
                    (row.lot.status === "in_stock" || isDirectSale(row.lot)) &&
                    setEditing(row.lot)
                  }
                  className={cn(
                    "border-b border-line/60 last:border-0 hover:bg-bg",
                    canEdit && row.lot.status === "in_stock" && "cursor-pointer",
                  )}
                >
                  {/* stopPropagation on the CELL, not just the input: a near
                      miss on the checkbox must not open the edit dialog. */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.type}`}
                      checked={selected.has(row.lot.id)}
                      onChange={() => toggleRow(row.lot.id)}
                      className="h-3.5 w-3.5 accent-accent align-middle"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-pill px-2 py-0.5 text-[10.5px] font-semibold",
                        STATUS_TONES[row.lot.status],
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-muted">
                    {new Date(row.date).toLocaleDateString(undefined, {
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-muted"
                    title={row.serial ? `Serial ${row.serial}` : undefined}
                  >
                    {row.imei || (row.serial ? `S/N ${row.serial}` : "—")}
                  </td>
                  <td
                    className="max-w-[240px] truncate px-3 py-2 text-ink"
                    title={`${row.type} — from ${row.customer}`}
                  >
                    {row.type}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{row.carrier || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{row.grade || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.lot.boughtBy ? (
                      row.boughtBy
                    ) : (
                      <span className="text-muted" title="Predates the bought-by column">
                        —
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {currency(row.cog)}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2">{row.buyer || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {row.invoice != null ? (
                      row.invoiceNo != null ? (
                        <Link
                          href={`/invoices/${row.lot.invoiceId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-accent hover:underline"
                          title={invoiceNumber(row.invoiceNo)}
                        >
                          {currency(row.invoice)}
                        </Link>
                      ) : (
                        currency(row.invoice)
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {row.sold != null ? currency(row.sold) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {row.ship != null && row.ship !== 0 ? currency(row.ship) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {row.fee != null && row.fee !== 0 ? currency(row.fee) : "—"}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums",
                      row.pl == null
                        ? "text-muted"
                        : row.pl < 0
                          ? "text-destructive"
                          : "text-status-received",
                    )}
                  >
                    {row.pl != null ? `${row.pl > 0 ? "+" : ""}${currency(row.pl)}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{row.source}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{row.paidVia || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              Nothing matches — clear a filter or widen the range.
            </p>
          )}
        </Card>
      )}

      <p className="mt-2 text-[11.5px] text-muted">
        {visible.length} of {rows.length} devices
        {truncated ? " · showing the most recent 1,000 — narrow the range for older history" : ""}
      </p>

      <LotEditDialog
        lot={editing}
        onClose={() => setEditing(null)}
        grades={grades}
        isAdmin={isAdmin}
      />
    </div>
  );
}

/** Local YYYY-MM-DD (not toISOString — that flips to UTC's date overnight). */
function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Sort accessor: dates and money sort numerically. */
function sortValue(row, key) {
  const value = row[key];
  return value ?? null;
}

function HeaderCell({ col, filters, setFilters, sort, setSort, menu, setMenu, optionsFor }) {
  const interactive = col.filter || col.sort;
  const active = filters[col.key];
  const sorted = sort?.key === col.key;
  const label = (
    <>
      {col.label}
      {sorted ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      {active ? ` · ${active}` : ""}
    </>
  );

  if (!interactive) {
    return <th className={cn("px-3 py-2.5", col.money && "text-right")}>{col.label}</th>;
  }

  return (
    <th
      className={cn(
        "relative px-3 py-2.5",
        col.money && "text-right",
        (active || sorted) && "text-accent",
      )}
    >
      <button
        type="button"
        onClick={() => setMenu(menu === col.key ? null : col.key)}
        className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-ink"
      >
        {label}
        <ChevronDown size={11} className="text-muted" />
      </button>
      {active && (
        <button
          type="button"
          aria-label={`Clear ${col.label} filter`}
          onClick={() => setFilters((f) => ({ ...f, [col.key]: null }))}
          className="ml-1 text-destructive"
        >
          ✕
        </button>
      )}
      {menu === col.key && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-[160px] overflow-y-auto rounded-xl border border-line bg-white p-1 text-left shadow-pop">
            {col.sort && (
              <>
                <MenuItem
                  selected={sorted && sort.dir === 1}
                  onClick={() => {
                    setSort({ key: col.key, dir: 1 });
                    setMenu(null);
                  }}
                >
                  Sort ↑
                </MenuItem>
                <MenuItem
                  selected={sorted && sort.dir === -1}
                  onClick={() => {
                    setSort({ key: col.key, dir: -1 });
                    setMenu(null);
                  }}
                >
                  Sort ↓
                </MenuItem>
                {sorted && (
                  <MenuItem
                    onClick={() => {
                      setSort(null);
                      setMenu(null);
                    }}
                  >
                    Clear sort
                  </MenuItem>
                )}
              </>
            )}
            {col.filter && (
              <>
                {col.sort && <div className="mx-1.5 my-1 h-px bg-line" />}
                <MenuItem
                  selected={!active}
                  onClick={() => {
                    setFilters((f) => ({ ...f, [col.key]: null }));
                    setMenu(null);
                  }}
                >
                  All
                </MenuItem>
                {/* Options come from the rows visible under every OTHER filter,
                    so a narrowed grid offers only what's on screen. */}
                {optionsFor(col.key).map((value) => (
                  <MenuItem
                    key={value}
                    selected={active === value}
                    onClick={() => {
                      setFilters((f) => ({ ...f, [col.key]: value }));
                      setMenu(null);
                    }}
                  >
                    {value}
                  </MenuItem>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </th>
  );
}

function MenuItem({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium normal-case tracking-normal",
        selected ? "bg-accent-l font-semibold text-accent" : "text-ink hover:bg-bg",
      )}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-2.5 shadow-xs">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cn("text-[17px] font-bold tabular-nums text-ink", tone)}>{value}</div>
      <div className="text-[10.5px] text-muted">{sub}</div>
    </div>
  );
}
