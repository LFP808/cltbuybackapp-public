import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/repositories/invoices";
import { officeAddress } from "@/lib/business";
import { currency } from "@/domain/format";
import { invoiceLines, unitCount } from "@/domain/inventory";
import { PrintButton } from "@/components/employee/invoices/PrintButton";

/**
 * The paper invoice, reproduced from the record — the document Jaime used to
 * assemble by hand. The employee shell hides itself under `print:` styles, so
 * the browser's print-to-PDF produces just this sheet; lines read
 * "iPhone 15 Pro Max - Unlocked A - IMEI …" because that grain (item ·
 * carrier · grade, one line per identified device) IS the lot grain.
 */
export default async function InvoicePrintPage({ params }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const business = await officeAddress();
  const buyer = invoice.buyer || {};
  const lots = [...(invoice.lots || [])].sort((a, b) => a.createdAt - b.createdAt);
  const balanceDue = invoice.status === "complete" ? 0 : invoice.projected;

  const addressLines = [
    buyer.street,
    buyer.street2,
    [buyer.city, buyer.state, buyer.zip].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl bg-white p-8 text-ink print:max-w-none print:p-0">
      <div className="mb-2 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <div className="flex items-start justify-between">
        <div className="text-[13px]">
          {/* The COMPANY line, not the name: a buyer's invoice headed by a
              personal name reads like a personal bill. */}
          <div className="font-semibold">{business.company}</div>
          {business.phone && <div className="text-muted">{business.phone}</div>}
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold tracking-tight">INVOICE</div>
          <div className="mt-1 text-[13px] text-muted"># {invoice.number}</div>
        </div>
      </div>

      <div className="mt-8 flex justify-between gap-6 text-[13px]">
        <div>
          <div className="text-muted">Bill To</div>
          <div className="mt-1 font-semibold">{buyer.name}</div>
          {addressLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <div>
          <div className="text-muted">Ship To</div>
          {addressLines.length ? (
            <div className="mt-1">
              {addressLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : (
            <div className="mt-1">—</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-muted">Date</div>
          <div className="mt-1 font-semibold">
            {new Date(invoice.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
      </div>

      <table className="mt-8 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-bg text-left">
            <th className="px-3 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Quantity</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {/* An IMEI device is its own line; identical identity-less units
              group into one line with a quantity — the shape of the document
              Jaime used to type by hand. */}
          {invoiceLines(lots).map((line) => {
            return (
              <tr key={line.key} className="border-b border-line/50">
                <td className="px-3 py-2.5">
                  {line.item}
                  {[line.carrier, line.grade].filter(Boolean).map((part) => ` - ${part}`)}
                  {line.imei || line.serial ? (
                    <span className="font-mono text-[11.5px]"> - {line.imei || line.serial}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{line.quantity}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {line.rate != null ? currency(line.rate) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {line.rate != null ? currency(line.invoiceTotal) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 ml-auto w-64 space-y-1 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="font-mono tabular-nums">{currency(invoice.projected)}</span>
        </div>
        {invoice.shipping > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Shipping</span>
            <span className="font-mono tabular-nums">{currency(invoice.shipping)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-line pt-1 font-semibold">
          <span>Total ({unitCount(lots)} units)</span>
          <span className="font-mono tabular-nums">{currency(invoice.projected)}</span>
        </div>
        <div className="flex justify-between text-[15px] font-bold">
          <span>Balance Due</span>
          <span className="font-mono tabular-nums">{currency(balanceDue)}</span>
        </div>
      </div>

      {buyer.terms && (
        <div className="mt-10 text-[13px]">
          <div className="text-muted">Terms</div>
          <div className="mt-1 whitespace-pre-line">{buyer.terms}</div>
        </div>
      )}
    </div>
  );
}
