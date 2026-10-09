"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Send, Printer } from "lucide-react";
import { Button, Card, StatusBadge, StatusStepper, SectionLabel } from "@/components/ui";
import { EditOrder } from "@/components/employee/order/EditOrder";
import { CancelOrder } from "@/components/employee/order/CancelOrder";
import { DeleteOrder } from "@/components/employee/order/DeleteOrder";
import { StageActions } from "@/components/employee/order/StageActions";
import { Reschedule } from "@/components/employee/order/Reschedule";
import { ConversationCard } from "@/components/employee/order/ConversationCard";
import { ItemsCard } from "@/components/employee/order/ItemsCard";
import { stagesForOrder, displayStage, canCancel, canDeleteOrder } from "@/domain/orders";
import { stageTemplate } from "@/domain/messages";
import { ConfirmSend } from "@/components/employee/ConfirmSend";
import { fmtPhone } from "@/domain/format";
import { resendStageTextAction } from "@/app/employee/actions";
import { runAction } from "@/lib/run-action";

/**
 * The operational heart of the app: move one order through its lifecycle.
 * Reads come from the server (props); every write goes through a server action
 * so status changes, payouts, and texts stay consistent.
 */
export function OrderDetail({
  shipment,
  canMessage = true,
  // TWO DIFFERENT QUESTIONS, and they were one prop.
  //
  // canMessage is "may this person talk to this customer". canEdit is "may
  // this person change the order" - reschedule it, correct it, cancel it.
  // Gating both on the first meant somebody who could only message was shown
  // Reschedule, Edit details and Cancel order, and every one of them came
  // back "You can't do that": buttons whose only function was to refuse the
  // person looking at them.
  canEdit = true,
  // ADMIN ONLY: strike the order from the books (devices out of inventory,
  // payout out of the money figures, row kept as a record). A third
  // permission, not folded into canEdit — the VA edits and cancels all day
  // and must never see a button that deletes.
  canDelete = false,
  // How many devices this order checked in — the label print offer. Zero
  // (or no check-in yet) means no button.
  labelCount = 0,
  // DB-backed item list for the edit dialog's items editor; empty means the
  // editor falls back to the static seed, same as the intake form.
  catalog = [],
  // The condition ladder for the edit dialog's per-line picker.
  grades,
  messages = [],
  calls = [],
  // Server-only env, passed down: the confirmation says whether a text will
  // really be delivered, and the browser cannot read SMS_TEST_MODE itself.
  smsTestMode = false,
  contact = null,
  // A meetup confirmation that failed during creation. The order was made and
  // the browser navigated here, so the only place left to say so is this page.
  textFailed = false,
  // What check-in actually counted, in dollars — null until the devices have
  // been checked in. Drives the payout prefill and the paid-vs-counted notice.
  checkInTotal = null,
  // True when a check-in EXISTS but its count could not be read. Not the same
  // as null above — that means "not counted yet" and legitimately falls back
  // to the promised total; this means "counted, unknown", which must block.
  checkInTotalUnknown = false,
  // Server-only template input, passed down so the send confirmations can
  // preview the same words the action will send: the office address reads
  // unprefixed env.
  officeLine = "",
  // Upcoming bookings (slim — see listAppointments), for the Reschedule slot
  // picker. Only fetched when Reschedule can render.
  appointments = [],
  // The admin-set booking schedule for the same picker; see /settings.
  bookingSchedule,
  // The admin-set payment methods for the payout select; undefined lets
  // StageActions fall back to the domain constant.
  paymentMethods,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A stage change whose text failed: the status moved, the customer wasn't
  // told. Distinct from `error`, which means the action itself failed. Seeded
  // from the server for the one case that happens before this page exists — a
  // meetup whose confirmation failed at creation, which redirects here.
  const [textError, setTextError] = useState(
    textFailed ? "The confirmation text could not be sent." : "",
  );
  // Which send confirmation is open: null | "resend".
  const [confirming, setConfirming] = useState(null);
  const stages = stagesForOrder(shipment);

  // The words the customer will actually read, from the same template the
  // action sends. Null when there is no phone or no stage message — then the
  // button skips the dialog and lets the action explain the refusal, rather
  // than opening a modal that promises a text it can't preview.
  const stageTpl = stageTemplate(shipment);
  const resendPreview = shipment.phone && stageTpl ? stageTpl(shipment, { officeLine }) : null;

  /**
   * `inline` is for a caller that renders the failure itself — a confirmation
   * dialog that keeps itself open to offer an override, where a red line at
   * the top of the page as well would be the same news twice.
   */
  async function run(fn, { inline = false } = {}) {
    setBusy(true);
    if (!inline) setError("");
    const outcome = await runAction(fn);
    setBusy(false);

    // On a refusal the previous textError must SURVIVE. Clearing it up front
    // meant a failed "Resend text" wiped the very banner — and its retry
    // button — that said the customer was never told.
    if (!outcome.ok) {
      if (!inline) setError(outcome.error);
      return outcome;
    }
    setTextError(outcome.result?.textError || "");
    return outcome;
  }

  return (
    // With a conversation: full width and exactly one screen tall, each column
    // scrolling inside itself so the composer never leaves the screen. Without
    // one this is a short list of facts, and stretching that across a wide
    // monitor makes it harder to read — so it stays narrow and scrolls like a
    // document.
    <div
      className={canMessage ? "w-full lg:flex lg:h-[calc(100vh-8.5rem)] lg:flex-col" : "max-w-3xl"}
    >
      {/* A meetup's parent is the calendar - that is where its slot lives. */}
      <Link
        href="/calendar"
        className="mb-3 inline-flex flex-shrink-0 items-center gap-1 self-start text-[13px] font-bold text-accent"
      >
        <ChevronLeft size={16} /> Calendar
      </Link>

      <Card className="mb-4 flex-shrink-0">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-serif text-xl text-ink">{shipment.name}</h1>
            <div className="mt-0.5 flex flex-col text-[12.5px] text-muted sm:flex-row sm:gap-1.5">
              <span>{fmtPhone(shipment.phone)}</span>
            </div>
          </div>
          <div className="flex-shrink-0">
            <StatusBadge order={shipment} />
          </div>
        </div>

        {/* Capped. Stretched over a wide monitor the connectors become metres
            of empty line and the stages stop reading as a sequence. */}
        <div className="max-w-2xl">
          <StatusStepper status={displayStage(shipment)} stages={stages} />
        </div>
      </Card>

      {error && <p className="mb-4 text-[13px] text-red-500">{error}</p>}

      {textError && (
        <Card className="mb-4 border-status-awaiting/40 bg-status-awaiting-bg/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {/* "Saved", not "Status updated": the same banner now covers a
                  creation whose confirmation failed, where no status moved. */}
              <p className="text-[13px] font-semibold text-status-awaiting">
                Saved, but the customer wasn&apos;t texted.
              </p>
              <p className="mt-0.5 text-[12px] text-muted">{textError}</p>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                resendPreview
                  ? setConfirming("resend")
                  : run(() => resendStageTextAction(shipment.id))
              }
            >
              <Send size={15} /> Resend text
            </Button>
          </div>
          <ConfirmSend
            open={confirming === "resend"}
            onClose={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              // run() clears the banner only when the resend actually succeeds.
              run(() => resendStageTextAction(shipment.id));
            }}
            title="Resend text"
            confirmLabel="Resend text"
            message={resendPreview}
            phone={fmtPhone(shipment.phone)}
            busy={busy}
            testMode={smsTestMode}
          />
        </Card>
      )}

      {/* Two columns on desktop: the JOB on the left, the CONVERSATION on the
          right. Stacked on mobile in the order someone works them — what to do,
          what they're bringing, then who to tell.

          The ORDER pane is the fixed one and the conversation takes the rest.
          It was the other way round, which gave a four-line list of items a
          thousand pixels of empty space while the thread was squeezed into a
          column narrower than a phone. The pane with the content gets the room. */}
      <div className="grid gap-x-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-stretch">
        <div className="min-w-0 lg:overflow-y-auto lg:pb-1 lg:pr-1">
          <StageActions
            shipment={shipment}
            busy={busy}
            run={run}
            smsTestMode={smsTestMode}
            checkInTotal={checkInTotal}
            checkInTotalUnknown={checkInTotalUnknown}
            contact={contact}
            paymentMethods={paymentMethods}
          />

          {/* Everything that changes the order itself (as opposed to moving it
              forward a stage), grouped in one place: the appointment mover,
              then edit/cancel/delete. These used to be three separate cards
              spread below the fold — Reschedule above the items, Cancel below
              the labels — so a no-show note up in StageActions had no visible
              way to act on it without scrolling past unrelated cards to find
              one. Delete stays visually last and is the admin's: Cancel ends
              an order, Delete says it should never have counted. */}
          {((canEdit && shipment.status === "awaiting") ||
            (canEdit && canCancel(shipment)) ||
            (canDelete && canDeleteOrder(shipment))) && (
            <Card className="mb-4">
              {canEdit && shipment.status === "awaiting" && (
                <div className="mb-3 border-b border-line/80 pb-3">
                  <Reschedule
                    shipment={shipment}
                    busy={busy}
                    run={run}
                    smsTestMode={smsTestMode}
                    officeLine={officeLine}
                    appointments={appointments}
                    bookingSchedule={bookingSchedule}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && shipment.status === "awaiting" && (
                  <EditOrder
                    shipment={shipment}
                    busy={busy}
                    run={run}
                    catalog={catalog}
                    grades={grades}
                  />
                )}
                {canEdit && canCancel(shipment) && (
                  <CancelOrder shipment={shipment} busy={busy} run={run} />
                )}
                {canDelete && canDeleteOrder(shipment) && (
                  <DeleteOrder shipment={shipment} busy={busy} run={run} />
                )}
              </div>
            </Card>
          )}

          {/* canEdit: reading the notes on an order is not the same as
              writing them — the same line every other order edit is drawn on. */}
          <ItemsCard shipment={shipment} canEdit={canEdit} />

          {/* The 4x2 device labels (condition + barcode + IMEI + device) for
              everything this order checked in. Opens the print sheet in a new
              tab so the order stays where it was. */}
          {shipment.checkedInAt && labelCount > 0 && (
            <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 py-3.5">
              <span className="text-[13px] text-muted">
                {labelCount} device{labelCount === 1 ? "" : "s"} checked in
              </span>
              <Button
                as="a"
                href={`/inventory/labels?order=${shipment.id}`}
                target="_blank"
                rel="noopener"
                variant="ghost"
                size="sm"
              >
                <Printer size={14} /> Print labels
              </Button>
            </Card>
          )}

          {/* Part of the order's record, so it lives with the order and scrolls
              with it. Below the fold as a full-width strip it was the reason
              the whole page scrolled and the composer kept leaving the screen. */}
          {shipment.activity?.length > 0 && (
            <>
              <SectionLabel>Activity</SectionLabel>
              <Card className="mb-4 space-y-2 text-[12.5px] text-muted">
                {[...shipment.activity].reverse().map((a, i) => (
                  // Stacks on a phone: a name and a full timestamp will not sit
                  // on one line at 360px, and squeezing them truncates the action.
                  <div
                    key={i}
                    className="flex flex-col justify-between gap-0.5 sm:flex-row sm:gap-3"
                  >
                    <span className="text-ink">{a.action}</span>
                    <span className="flex-shrink-0">
                      {a.by} · {new Date(a.at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>

        <ConversationCard
          shipment={shipment}
          messages={messages}
          calls={calls}
          contact={contact}
          canMessage={canMessage}
          busy={busy}
          onError={setError}
        />
      </div>
    </div>
  );
}
