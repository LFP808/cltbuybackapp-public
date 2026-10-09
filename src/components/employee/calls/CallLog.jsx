"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Phone,
  FileText,
  ChevronDown,
  User,
  Voicemail,
  Check,
  UserPlus,
  RotateCcw,
  Hash,
} from "lucide-react";
import { Card, Button, Input, Modal, DialogFooter, Badge } from "@/components/ui";
import { useVoice } from "@/components/employee/voice/Softphone";
import { CallCustomerButton } from "@/components/employee/voice/CallCustomerButton";
import { useRealtime } from "@/lib/use-realtime";
import { runAction } from "@/lib/run-action";
import { fmtPhone } from "@/domain/format";
import {
  CALL_FILTERS,
  matchesFilter,
  callOutcome,
  isLive,
  isMissed,
  hasVoicemail,
  needsFollowUp,
  formatDuration,
} from "@/domain/calls";
import { menuChoiceLabel } from "@/domain/phone-menu";
import { setCallHandledAction, addCallerAsCustomerAction } from "@/app/employee/calls/actions";
import { cn } from "@/lib/cn";

/**
 * The call log, live.
 *
 * Subscribes to inserts AND updates on `calls`: a call's life is mostly
 * updates - it appears while ringing, gains an answerer, then a duration, then
 * a recording, then a transcript - so an insert-only subscription would show a
 * list of calls that never progress.
 *
 * Refreshes server data rather than patching rows in place, for the same
 * reason the inbox does: one source of truth, and no chance of a locally
 * patched row disagreeing with what the next navigation loads.
 */
export function CallLog({ initialCalls }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // The caller being turned into a customer, or null.
  const [adding, setAdding] = useState(null);
  const [newName, setNewName] = useState("");
  const { call: placeCall, ready } = useVoice();

  // Every event, not just inserts: a call's life is mostly updates. The token
  // handling — including re-pushing it when it refreshes, which this used to
  // omit and so went silent an hour into a shift — lives in the hook.
  useRealtime({
    channel: "call-log",
    table: "calls",
    onChange: useCallback(() => router.refresh(), [router]),
  });

  const calls = initialCalls.filter((c) => matchesFilter(c, filter));
  // Counted over EVERY call, not the filtered view, so the number doesn't
  // change as you move between tabs.
  const outstanding = initialCalls.filter(needsFollowUp).length;

  function run(fn) {
    setError("");
    startTransition(async () => {
      const { ok, error: why } = await runAction(fn);
      if (!ok) setError(why);
      else router.refresh();
    });
  }

  function addCaller(e) {
    e.preventDefault();
    const call = adding;
    setAdding(null);
    run(() => addCallerAsCustomerAction({ callId: call.id, phone: call.phone, name: newName }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-pill border-[1.5px] border-line bg-white p-1">
          {CALL_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-pill px-4 py-1.5 text-[13px] font-semibold",
                filter === f.key ? "bg-accent text-white" : "text-muted",
              )}
            >
              {f.label}
              {f.key === "follow_up" && outstanding > 0 && (
                <span className="ml-1.5 text-[11px] opacity-80">{outstanding}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[13px] text-red-500">{error}</p>}

      {calls.length === 0 ? (
        <Card className="text-[13px] italic text-muted">
          {filter === "follow_up"
            ? "Nothing waiting on a callback."
            : filter === "voicemail"
              ? "No voicemails."
              : "No calls yet."}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {calls.map((c) => (
            <CallRow
              key={c.id}
              call={c}
              open={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              onCallBack={ready ? () => placeCall(c.phone) : null}
              busy={pending}
              onHandled={(handled) => run(() => setCallHandledAction(c.id, handled))}
              onAdd={() => {
                setAdding(c);
                setNewName("");
              }}
            />
          ))}
        </div>
      )}

      {/* A caller who has only ever phoned exists nowhere — not in Customers,
          not in the inbox — so there was no record to attach anything to and
          no way to text them back. A name is all it takes to create one. */}
      <Modal open={Boolean(adding)} onClose={() => setAdding(null)} title="Add caller as customer">
        {adding && (
          <form onSubmit={addCaller} className="space-y-3">
            <p className="text-[13px] text-muted">
              Creates a customer record for {fmtPhone(adding.phone)} so you can text them, take an
              order, and keep notes. This also marks the call followed up.
            </p>
            <Input
              label="Name"
              placeholder="Whatever they gave you on the phone"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !newName.trim()}>
                Add customer
              </Button>
            </DialogFooter>
          </form>
        )}
      </Modal>
    </div>
  );
}

function CallRow({ call, open, onToggle, onCallBack, busy, onHandled, onAdd }) {
  const live = isLive(call);
  const missed = isMissed(call);
  const voicemail = hasVoicemail(call);
  const waiting = needsFollowUp(call);
  const Icon = voicemail
    ? Voicemail
    : missed
      ? PhoneMissed
      : call.direction === "outbound"
        ? PhoneOutgoing
        : PhoneIncoming;
  const hasDetail = Boolean(
    call.recordingUrl || call.voicemailUrl || call.transcript || call.transcriptStatus,
  );

  return (
    <Card
      className={cn("p-0 transition-colors", live && "border-accent bg-accent-l/30")}
      // Padding lives on the inner rows so the expanded panel can span edge to edge.
    >
      <div className="flex items-center gap-3 p-3.5">
        <span
          className={cn(
            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
            live
              ? "animate-pulse bg-accent text-white"
              : missed
                ? "bg-red-50 text-red-500"
                : "bg-bg text-muted",
          )}
        >
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={`/customers/${call.phone}`}
              className="truncate text-[13.5px] font-semibold text-ink hover:text-accent"
            >
              {fmtPhone(call.phone) || "Unknown number"}
            </Link>
            <span
              className={cn(
                "flex-shrink-0 text-[11px] font-semibold",
                live ? "text-accent" : missed ? "text-red-500" : "text-muted",
              )}
            >
              {callOutcome(call)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
            <span>{new Date(call.startedAt).toLocaleString()}</span>
            {call.durationSecs > 0 && <span>· {formatDuration(call.durationSecs)}</span>}
            {/* What they pressed on the phone menu - the reason for the call,
                known before anyone picks up and still here for the callback. */}
            {menuChoiceLabel(call.menuChoice) && (
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                · <Hash size={10} /> {menuChoiceLabel(call.menuChoice)}
              </span>
            )}
            {call.answeredName && (
              <span className="inline-flex items-center gap-1">
                · <User size={10} /> {call.answeredName}
              </span>
            )}
            {voicemail && (
              <span className="inline-flex items-center gap-1 font-semibold text-accent">
                · <Voicemail size={10} /> Voicemail
                {call.voicemailSecs > 0 && ` ${formatDuration(call.voicemailSecs)}`}
              </span>
            )}
            {/* Says the callback already happened AND who did it — the whole
                reason this is a timestamp rather than a checkbox. */}
            {call.handledAt && (
              <span className="inline-flex items-center gap-1 text-accent">
                · <Check size={10} /> {call.handledBy || "Handled"}
              </span>
            )}
            {call.missedTextedAt && <span>· auto-texted</span>}
          </div>
        </div>

        {waiting && (
          <Badge className="flex-shrink-0 bg-status-awaiting-bg text-status-awaiting">
            Needs callback
          </Badge>
        )}

        {onCallBack && !live && (
          <button
            onClick={onCallBack}
            aria-label={`Call ${fmtPhone(call.phone)} back`}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:border-accent hover:bg-accent-l hover:text-accent"
          >
            <Phone size={14} />
          </button>
        )}

        {/* The admin's call-through: rings his cell, then this caller. Not
            offered while the call is still live — there is nobody to call
            back yet. */}
        {!live && <CallCustomerButton phone={call.phone} label="Call back" />}

        {hasDetail && (
          <button
            onClick={onToggle}
            aria-label={open ? "Hide recording" : "Show recording and transcript"}
            aria-expanded={open}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
          >
            <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {/* The follow-up controls live on the row, not behind the expander: the
          point of the queue is to work it without opening anything. */}
      {(waiting || call.handledAt) && call.direction === "inbound" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2">
          {waiting ? (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onHandled(true)}>
                <Check size={14} /> Mark followed up
              </Button>
              {/* Only for a number we hold nothing on. Someone with orders or
                  messages already has a record; sending them here would make a
                  duplicate. */}
              {call.phone && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onAdd}>
                  <UserPlus size={14} /> Add as customer
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onHandled(false)}>
              <RotateCcw size={14} /> Reopen
            </Button>
          )}
        </div>
      )}

      {open && hasDetail && (
        <div className="space-y-3 border-t border-line bg-bg/50 p-3.5">
          {call.voicemailUrl && (
            <div>
              <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                <Voicemail size={11} /> Voicemail
              </h4>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- voicemail has no transcript to caption with */}
              <audio controls preload="none" src={call.voicemailUrl} className="w-full" />
            </div>
          )}
          {call.recordingUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below IS the caption
            <audio controls preload="none" src={call.recordingUrl} className="w-full" />
          )}
          {/* Only where a transcript could exist. A voicemail-only row would
              otherwise carry a "Transcription is not switched on" notice about
              a conversation that never happened. */}
          {(call.recordingUrl || call.transcript || call.transcriptStatus) && (
            <div>
              <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                <FileText size={11} /> Transcript
              </h4>
              {call.transcript ? (
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                  {call.transcript}
                </p>
              ) : (
                <p className="text-[12.5px] italic text-muted">
                  {call.transcriptStatus === "pending"
                    ? "Transcribing…"
                    : call.transcriptStatus === "failed"
                      ? "Transcription failed for this call."
                      : "Transcription is not switched on."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
