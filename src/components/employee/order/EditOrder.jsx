"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button, Modal, Input, DialogFooter } from "@/components/ui";
import { ItemsEditor } from "@/components/employee/new-order/ItemsEditor";
import { uid } from "@/domain/format";
import { isWalkIn } from "@/domain/orders";
import { updateOrderAction } from "@/app/employee/actions";

/**
 * Fix what was typed — and change what's being sold.
 *
 * Two different phone calls land here: "you spelled my name wrong" and
 * "actually I'm bringing my iPad too". Both happen while the order is still
 * awaiting, which is the only window this dialog exists in: past that the row
 * is a record of what happened, not a draft. Items use the same catalog
 * editor as intake, so adding a line here is the same motion as adding it
 * when the order was taken — and the check-in count remains the money truth,
 * so a promise edited here can never overpay by itself.
 */
export function EditOrder({ shipment, busy, run, catalog = [], grades }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: shipment.name || "",
    phone: shipment.phone || "",
  });
  // The editor's rows carry a client id and string qty/price (fields must be
  // clearable while typing); stored lines carry numbers and may carry a
  // check-in note. Seed strings in, coerce numbers out, and PRESERVE what the
  // editor doesn't know about (note, noteBy, noteAt) — an edit to the
  // quantity must not eat the note somebody wrote on the line.
  const [items, setItems] = useState(() =>
    (shipment.items || []).map((it) => ({
      ...it,
      id: uid(),
      quantity: String(it.quantity ?? 1),
      price: it.price != null ? String(it.price) : "",
      condition: it.condition || "",
    })),
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save() {
    setOpen(false);
    const priced = items.map(({ id: _id, ...it }) => ({
      ...it,
      quantity: Number(it.quantity) || 1,
      price: Number(it.price) || 0,
    }));
    run(() => updateOrderAction(shipment.id, { ...form, items: priced }));
  }

  return (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <Pencil size={15} /> Edit details
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit order">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Customer name" value={form.name} onChange={set("name")} />
            <Input label="Phone" value={form.phone} onChange={set("phone")} />
          </div>

          {/* Same editor as intake — the "I'm bringing more" call is the same
              motion as taking the order, and the estimate updates with it
              (payout prefill fallback and the cash float both read it). */}
          <ItemsEditor
            items={items}
            setItems={setItems}
            catalog={catalog}
            grades={grades}
            // Only an awaiting order is editable, and an awaiting order is a
            // booking — so the per-line condition is required here too. An
            // order booked before conditions existed gets asked for them on
            // its first edit, which is the moment someone is on it anyway.
            requireCondition={!isWalkIn(shipment)}
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={save}>
              Save changes
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </>
  );
}
