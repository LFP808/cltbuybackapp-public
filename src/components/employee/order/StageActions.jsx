"use client";

import { useState } from "react";
import { DollarSign, Handshake } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { displayStage, receivedActionLabel, stopOutcomeLabel } from "@/domain/orders";
import { ConfirmSend } from "@/components/employee/ConfirmSend";
import { StopOutcome } from "@/components/employee/order/StopOutcome";
import { CorrectPayout } from "@/components/employee/order/CorrectPayout";
import { fmtPhone, currency, itemsTotal } from "@/domain/format";
import { PAYMENT_METHODS } from "@/domain/constants";
import { advanceOrderAction } from "@/app/employee/actions";

export function StageActions({
  shipment,
  busy,
  run,
  smsTestMode = false,
  // Dollars actually counted at check-in; null until the devices are checked in.
  checkInTotal = null,
  // A check-in exists but its count couldn't be read. Distinct from null:
  // null falls back to the promised total, which is right for "not counted
  // yet" and an $80 overpayment waiting to happen for "counted, read failed".
  checkInTotalUnknown = false,
  // Contact facts (contact_notes): the payout form shows where this person
  // likes their payout sent.
  contact = null,
  // Admin-set list from app_settings (see /settings); the constant is only
  // the fallback for a caller that didn't fetch it.
  paymentMethods = PAYMENT_METHODS,
}) {
  // The payout starts from what was COUNTED when a check-in exists, and only
  // falls back to what was promised at intake. Counting beats promising.
  const [amount, setAmount] = useState(
    checkInTotal != null ? String(checkInTotal) : String(itemsTotal(shipment.items) || ""),
  );
  // Defaulted by CONTEXT, not by list order. A meetup handover is paid at the
  // counter, most often from the drawer; leaving "Zelle" preselected there
  // meant one missed dropdown recorded a cash payout as Zelle and skewed the
  // cash share that sizes tomorrow's float. (Guarded against an admin who
  // removed Cash from the list — a select whose value isn't an option
  // renders blank and submits a method nobody picked.)
  const [method, setMethod] = useState(
    paymentMethods.includes("Cash") ? "Cash" : paymentMethods[0] || "Cash",
  );
  const [payoutReason, setPayoutReason] = useState(
    checkInTotal != null && checkInTotal !== itemsTotal(shipment.items)
      ? "Adjusted to match the check-in count"
      : "",
  );
  // Which confirmation is open: null | "received" | "paid".
  const [confirming, setConfirming] = useState(null);

  // Branch on the DERIVED stage, never on the raw status - displayStage is the
  // one branch point, so anything it ever learns to derive shows up here too.
  const stage = displayStage(shipment);

  // No message previews: bought and paid never announce (announcesStage) — a
  // person at the counter just said it out loud — so the confirmation dialog
  // says "no text will be sent", which is the truth worth confirming.
  const confirmReceived = (
    <ConfirmSend
      open={confirming === "received"}
      onClose={() => setConfirming(null)}
      onConfirm={() => {
        setConfirming(null);
        run(() => advanceOrderAction(shipment.id, "received"));
      }}
      title={receivedActionLabel(shipment)}
      confirmLabel={receivedActionLabel(shipment)}
      message={null}
      phone={fmtPhone(shipment.phone)}
      busy={busy}
      testMode={smsTestMode}
    />
  );

  // DELETED -------------------------------------------------------------------
  // Struck from the books by an admin. Underneath it is status cancelled, so
  // this branch must come first or the cancel card would claim it.
  if (stage === "deleted") {
    return (
      <ActionCard>
        <p className="text-[13px] font-semibold text-destructive">
          Deleted
          {shipment.deletedAt ? ` on ${new Date(shipment.deletedAt).toLocaleDateString()}` : ""}
          {shipment.deletedBy ? ` by ${shipment.deletedBy}` : ""}
          {shipment.deleteReason ? ` - ${shipment.deleteReason}` : ""}.
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          Kept as a record only. Its devices were removed from inventory and nothing on this order
          counts toward the money figures. The activity trail below says what was here.
        </p>
      </ActionCard>
    );
  }

  // CANCELLED -----------------------------------------------------------------
  if (stage === "cancelled") {
    return (
      <ActionCard>
        <p className="text-[13px] text-muted">
          Cancelled{shipment.cancelReason ? ` - ${shipment.cancelReason}` : ""}. No payment was
          made.
        </p>
      </ActionCard>
    );
  }

  // AWAITING ------------------------------------------------------------------
  if (stage === "awaiting") {
    return (
      <ActionCard>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => setConfirming("received")}>
            <Handshake size={16} /> {receivedActionLabel(shipment)}
          </Button>
          {/* The other half of a booked meetup. Without it the only way to
              record a no-show was to claim a successful handover. */}
          <StopOutcome shipment={shipment} busy={busy} run={run} />
        </div>
        {shipment.stopOutcome && (
          <p className="mt-2.5 text-[12px] text-status-awaiting">
            Last visit: {stopOutcomeLabel(shipment.stopOutcome)}
            {shipment.stopOutcomeNote ? ` - ${shipment.stopOutcomeNote}` : ""}
            {shipment.stopOutcomeAt
              ? ` (${new Date(shipment.stopOutcomeAt).toLocaleDateString()})`
              : ""}
          </p>
        )}
        {confirmReceived}
      </ActionCard>
    );
  }

  // RECEIVED ------------------------------------------------------------------
  if (stage === "received") {
    // The devices WERE counted and the count didn't load. The form's fallback
    // would quietly prefill the PROMISED total — the exact number check-in
    // exists to overrule — so the payout waits for a page that knows the
    // count. A failed read never un-gates the money.
    if (checkInTotalUnknown) {
      return (
        <ActionCard title="Record payout">
          <p className="text-[13px] text-muted">
            The check-in count couldn&apos;t be loaded just now, so the payout can&apos;t prefill
            from what was actually counted. Refresh the page — if this keeps up, the payout stays
            blocked rather than guessing from the promised total.
          </p>
        </ActionCard>
      );
    }

    // What was agreed at intake, against what is about to be paid.
    const agreed = itemsTotal(shipment.items);
    const differs = agreed > 0 && Number(amount) !== agreed;
    return (
      <ActionCard title="Record payout">
        {checkInTotal != null && (
          <p className="mb-2 inline-flex rounded-pill bg-accent-l px-2.5 py-0.5 text-[11.5px] font-semibold text-accent">
            From check-in: {currency(checkInTotal)}
          </p>
        )}
        {/* The fact that used to live in a text message somebody had to go
            find with money waiting: where this person's payout goes. */}
        {(contact?.preferredPaymentMethod || contact?.paymentHandle) && (
          <p className="mb-2 text-[12.5px] text-muted">
            Prefers{" "}
            <span className="font-semibold text-ink">{contact.preferredPaymentMethod || "—"}</span>
            {contact.paymentHandle && (
              <>
                {" "}
                → send to <span className="font-semibold text-ink">{contact.paymentHandle}</span>
              </>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="w-28 rounded-lg border border-line px-3 py-2 text-[13px]"
          />
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-[13px]"
          >
            {paymentMethods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          {/* onClick belongs on the Button, not on an inner span: the span
              stops at the text, so the button's padding was a dead 16px strip
              that swallowed clicks and did nothing. */}
          <Button
            disabled={busy || !amount || (differs && !payoutReason.trim())}
            onClick={() => setConfirming("paid")}
          >
            <DollarSign size={16} /> Record payment
          </Button>
        </div>

        {/* The app does not move money and never has. A button beside a
            method dropdown reads like it might, and a new starter who believes
            it walks away thinking the customer was paid when nothing moved. */}
        <p className="mt-2 text-[12px] text-muted">
          {method === "Cash"
            ? "Hand the cash over first — this only records the payout. It does not move any money."
            : `Send the ${method} payment yourself first — this only records the payout. It does not move any money.`}
        </p>

        {/* THE INSPECTION STEP. Devices turn up cracked, iCloud-locked or a
            storage tier down, and the payout changes accordingly — but a
            smaller number with no reason is indistinguishable from a typo six
            weeks later, and the customer who asks "why $90?" deserves an
            answer that exists. Only asked for when the amount actually
            differs, so the ordinary case stays one click. */}
        {differs && (
          <div className="mt-3 rounded-lg bg-status-awaiting-bg/40 p-2.5">
            <label className="text-[12px] font-semibold text-status-awaiting">
              {Number(amount) < agreed ? "Paying less than agreed" : "Paying more than agreed"} (
              {currency(agreed)} agreed)
            </label>
            <input
              value={payoutReason}
              onChange={(e) => setPayoutReason(e.target.value)}
              placeholder="Why? e.g. cracked screen, Find My still on"
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent"
            />
          </div>
        )}

        <ConfirmSend
          open={confirming === "paid"}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            run(() =>
              advanceOrderAction(shipment.id, "paid", {
                paidAmount: Number(amount),
                paymentMethod: method,
                payoutReason: differs ? payoutReason.trim() : null,
              }),
            );
          }}
          title="Record payment"
          confirmLabel={`Pay ${currency(Number(amount) || 0)}`}
          message={null}
          phone={fmtPhone(shipment.phone)}
          busy={busy}
          testMode={smsTestMode}
        />
      </ActionCard>
    );
  }

  // PAID ----------------------------------------------------------------------
  // A meetup pays at the handover and gets counted afterwards, so this is
  // where its audit lands: what was paid against what check-in found.
  const paidGap =
    shipment.checkedInAt && checkInTotal != null && shipment.paidAmount != null
      ? Math.round((checkInTotal - shipment.paidAmount) * 100) / 100
      : null;

  return (
    <ActionCard>
      <p className="text-[13px] text-muted">
        Paid {currency(shipment.paidAmount)} via {shipment.paymentMethod}. This order is complete.
      </p>
      {shipment.payoutReason && (
        <p className="mt-1 text-[12px] text-muted">Adjusted: {shipment.payoutReason}</p>
      )}
      {paidGap != null && Math.abs(paidGap) >= 0.005 && (
        <p className="mt-2 rounded-lg bg-status-awaiting-bg px-2.5 py-1.5 text-[12px] text-status-awaiting">
          Check-in counted {currency(checkInTotal)} — {currency(Math.abs(paidGap))}{" "}
          {paidGap < 0 ? "less" : "more"} than was paid. Review it below; nothing changes on its
          own.
        </p>
      )}
      {/* Same honesty as the payout gate above: a silent nothing here would
          read as "paid matches counted" when the truth is "couldn't compare". */}
      {checkInTotalUnknown && (
        <p className="mt-2 rounded-lg bg-status-awaiting-bg px-2.5 py-1.5 text-[12px] text-status-awaiting">
          The check-in count couldn&apos;t be loaded, so paid-vs-counted isn&apos;t shown. Refresh
          to compare.
        </p>
      )}
      {/* The one field still correctable after the fact, because a typo here
          outlives the order — it feeds every total on the dashboard. */}
      <CorrectPayout
        shipment={shipment}
        busy={busy}
        run={run}
        // The counted total is the obvious correction; the reason writes itself.
        suggestedAmount={paidGap != null && Math.abs(paidGap) >= 0.005 ? checkInTotal : undefined}
        suggestedReason={
          paidGap != null && Math.abs(paidGap) >= 0.005
            ? `Check-in counted ${currency(checkInTotal)}`
            : undefined
        }
      />
    </ActionCard>
  );
}

function ActionCard({ title, children }) {
  return (
    <Card className="mb-4">
      {title && <div className="mb-2 text-[13px] font-semibold text-ink">{title}</div>}
      {children}
    </Card>
  );
}
