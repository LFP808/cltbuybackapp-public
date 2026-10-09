"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, Button, StatusBadge, Mono } from "@/components/ui";
import { ContactNotesEditor } from "./ContactNotesEditor";
import { ContactFacts } from "@/components/employee/customers/ContactFacts";
import { CallButton } from "@/components/employee/voice/CallButton";
import { CallCustomerButton } from "@/components/employee/voice/CallCustomerButton";
import { CallHistory } from "@/components/employee/calls/CallHistory";
import { EditableName } from "@/components/employee/customers/EditableName";
import { fmtPhone, firstNameOf, currency } from "@/domain/format";

/**
 * Right-hand profile panel for the selected conversation: identity, quick
 * stats, a new-order shortcut, the customer's orders, and the notes editor.
 */
export function ContactProfile({ conversation, onSaveNotes }) {
  const c = conversation;

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <EditableName
          as="h2"
          phone={c.phone}
          name={c.name}
          className="font-serif text-[17px] text-ink"
        />
        <div className="mt-0.5 text-[12.5px] text-muted">{fmtPhone(c.phone)}</div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          <Stat label="Orders" value={c.shipmentCount} />
          <Stat label="Total paid" value={currency(c.totalPaid)} />
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            as={Link}
            href={`/new?phone=${c.phone}&name=${encodeURIComponent(c.name)}`}
            className="min-w-0 flex-1"
          >
            <Plus size={14} /> New order for {firstNameOf(c.name)}
          </Button>
          {/* Renders only when this browser's phone is registered — a call
              button that silently does nothing reads as a broken app. */}
          <CallButton phone={c.phone} />
          {/* The admin's call-through — rings his cell, then the customer. */}
          <CallCustomerButton phone={c.phone} name={c.name} />
        </div>

        {c.currentOrders.length > 0 && (
          <OrderGroup title="Current orders">
            {c.currentOrders.map((o) => (
              <OrderRow key={o.id} order={o}>
                <StatusBadge order={o} />
              </OrderRow>
            ))}
          </OrderGroup>
        )}

        {c.pastOrders.length > 0 && (
          <OrderGroup title="Past orders">
            {c.pastOrders.map((o) => (
              <OrderRow key={o.id} order={o}>
                {/* Cancelled orders are finished, so they list here — but they
                    were never paid, and a green $0.00 says the opposite. */}
                {o.status === "cancelled" ? (
                  <span className="text-[11.5px] font-semibold text-muted">Cancelled</span>
                ) : (
                  <span className="font-serif text-[12.5px] text-accent">
                    {currency(o.paidAmount)}
                  </span>
                )}
              </OrderRow>
            ))}
          </OrderGroup>
        )}

        {c.shipmentCount === 0 && (
          <p className="mt-3.5 text-[12.5px] italic text-muted">No orders yet for this customer.</p>
        )}

        {/* Calls sit with the texts because they are the same conversation by
            another channel — what was agreed on the phone is exactly what you
            go looking for when reading back a thread. */}
        <OrderGroup title="Calls">
          <CallHistory calls={c.calls ?? []} />
        </OrderGroup>

        {/* Standing facts, matching the customer page. */}
        <div className="mt-4 border-t border-line pt-4">
          <ContactFacts
            phone={c.phone}
            leadSource={c.leadSource}
            preferredPaymentMethod={c.preferredPaymentMethod}
            paymentHandle={c.paymentHandle}
          />
        </div>

        {/* Same card as the identity it describes, matching the customer page. */}
        <div className="mt-4 border-t border-line pt-4">
          <ContactNotesEditor notes={c.notes} tags={c.tags} onSave={onSaveNotes} />
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-0.5 font-semibold text-ink">{value}</div>
    </div>
  );
}

function OrderGroup({ title, children }) {
  return (
    <div className="mt-3.5">
      <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{title}</span>
      <div className="mt-1.5 flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function OrderRow({ order, children }) {
  return (
    <Link
      href={`/orders/${order.id}`}
      className="flex items-center justify-between rounded-lg bg-bg px-2.5 py-2 hover:bg-accent-l"
    >
      <Mono className="text-[12px] text-ink">{order.label}</Mono>
      {children}
    </Link>
  );
}
