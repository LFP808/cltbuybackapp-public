"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, StatusBadge, Modal, Input, DialogFooter } from "@/components/ui";
import { closeCheckInAction } from "@/app/employee/inventory/actions";
import { runAction } from "@/lib/run-action";
import { orderTypeLabel } from "@/domain/orders";

/**
 * The check-in queue as a table: who, what kind of visit, what devices to
 * expect, and one action. Oldest first (the page sorts), so the top row is
 * always the buy that has waited longest.
 */
export function PendingCheckins({ queue, canCheckIn = true }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function close() {
    const order = closing;
    const why = reason;
    setClosing(null);
    setError("");
    startTransition(async () => {
      const { ok, error: message } = await runAction(() => closeCheckInAction(order.id, why));
      if (!ok) setError(message);
      else router.refresh();
    });
  }

  if (!queue.length) {
    return (
      <EmptyState
        title="Nothing waiting"
        description="Orders land here when they're marked bought, until their devices are checked in."
      />
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
            <th className="px-4 py-2.5">Customer</th>
            <th className="px-3 py-2.5">Order</th>
            <th className="px-3 py-2.5">Arrived</th>
            <th className="px-3 py-2.5 text-center">Expected</th>
            <th className="px-3 py-2.5">Items</th>
            <th className="px-3 py-2.5" />
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {queue.map((order) => {
            const units = (order.items || []).reduce(
              (sum, it) => sum + (Number(it.quantity) || 0),
              0,
            );
            // The stated condition rides along: "iPhone 15 (B) ×1" tells the
            // counter what to expect before the device is in hand.
            const summary = (order.items || [])
              .map((it) => `${it.name}${it.condition ? ` (${it.condition})` : ""} ×${it.quantity}`)
              .join(", ");
            return (
              <tr key={order.id} className="border-b border-line/60 last:border-0 hover:bg-bg">
                <td className="px-4 py-2.5 font-semibold text-ink">
                  <Link href={`/orders/${order.id}`} className="hover:underline">
                    {order.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                  {orderTypeLabel(order)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{arrivalOf(order)}</td>
                <td className="px-3 py-2.5 text-center font-mono tabular-nums">{units}</td>
                <td className="max-w-[340px] truncate px-3 py-2.5 text-muted" title={summary}>
                  {summary || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge order={order} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {/* Both buttons WRITE — one creates lots, the other stamps
                      the order as counted. Someone without inventory write
                      access sees the queue without the two controls that
                      would refuse them. */}
                  {!canCheckIn ? (
                    <span className="text-[12px] text-muted">Waiting to be counted</span>
                  ) : (
                    <>
                      <Button as={Link} href={`/inventory/check-in/${order.id}`} size="sm">
                        Check in
                      </Button>
                      {/* The way OUT of this queue for a buy with nothing to
                      count. Without it a rejected or kept device sits at the
                      top of an oldest-first list for ever — and a paid order
                      can't be cancelled either, so there was no exit at all. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-1.5"
                        disabled={pending}
                        onClick={() => {
                          setClosing(order);
                          setReason("");
                        }}
                      >
                        Nothing to count
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {error && <p className="px-4 py-2 text-[13px] text-red-500">{error}</p>}

      <Modal
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title="Close without counting"
      >
        {closing && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              Clears {closing.name} from the check-in queue without creating any inventory.
            </p>
            <p className="text-[12px] text-muted">
              For devices that were rejected, kept by the customer, or an order already settled with
              nothing left to count. The reason goes on the order&apos;s activity trail — it is the
              only record this happened.
            </p>
            <Input
              label="Why?"
              placeholder="e.g. customer kept the device, nothing usable"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setClosing(null)}>
                Cancel
              </Button>
              <Button disabled={pending || !reason.trim()} onClick={close}>
                Close check-in
              </Button>
            </DialogFooter>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/** When the devices actually got here, read off the activity trail. */
function arrivalOf(order) {
  const entry = [...(order.activity || [])]
    .reverse()
    .find((a) => typeof a.action === "string" && a.action.startsWith("Marked received"));
  const at = entry?.at ?? order.createdAt;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
