"use client";

import { useState } from "react";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, ChevronDown } from "lucide-react";
import { callOutcome, isLive, isMissed, formatDuration } from "@/domain/calls";
import { cn } from "@/lib/cn";

/**
 * One customer's calls, sized for a side panel.
 *
 * The compact sibling of the full CallLog: same information, no filters, no
 * customer link (you are already looking at them), and the recording and
 * transcript folded away until asked for. A transcript is several hundred
 * words - unfolded by default it would bury the orders above it.
 *
 * Deliberately not its own realtime subscription. This renders inside surfaces
 * that already refresh on server data, and a second socket per customer panel
 * is a lot of machinery for a list that changes when a call ends.
 */
export function CallHistory({ calls = [], limit = 5 }) {
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);

  if (calls.length === 0) {
    return <p className="text-[12.5px] italic text-muted">No calls with this customer yet.</p>;
  }

  const shown = showAll ? calls : calls.slice(0, limit);

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((c) => (
        <CallEntry
          key={c.id}
          call={c}
          open={open === c.id}
          onToggle={() => setOpen(open === c.id ? null : c.id)}
        />
      ))}

      {calls.length > limit && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="self-start text-[11.5px] font-semibold text-accent hover:underline"
        >
          Show {calls.length - limit} more
        </button>
      )}
    </div>
  );
}

function CallEntry({ call, open, onToggle }) {
  const live = isLive(call);
  const missed = isMissed(call);
  const Icon = missed ? PhoneMissed : call.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
  const hasDetail = Boolean(call.recordingUrl || call.transcript || call.transcriptStatus);

  return (
    <div className={cn("rounded-lg bg-bg", live && "bg-accent-l")}>
      <button
        onClick={hasDetail ? onToggle : undefined}
        aria-expanded={hasDetail ? open : undefined}
        // Not a button when there is nothing to open — a control that does
        // nothing when pressed is worse than plain text.
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-2 text-left",
          hasDetail && "hover:bg-accent-l/60",
          !hasDetail && "cursor-default",
        )}
      >
        <Icon
          size={13}
          className={cn(
            "flex-shrink-0",
            live ? "text-accent" : missed ? "text-red-500" : "text-muted",
          )}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[12px] font-semibold",
              missed ? "text-red-500" : live ? "text-accent" : "text-ink",
            )}
          >
            {callOutcome(call)}
            {call.durationSecs > 0 && (
              <span className="font-normal text-muted"> · {formatDuration(call.durationSecs)}</span>
            )}
          </span>
          <span className="block text-[10.5px] text-muted">
            {new Date(call.startedAt).toLocaleString()}
            {call.answeredName ? ` · ${call.answeredName}` : ""}
          </span>
        </span>
        {hasDetail && (
          <ChevronDown
            size={13}
            className={cn("flex-shrink-0 text-muted transition-transform", open && "rotate-180")}
          />
        )}
      </button>

      {open && hasDetail && (
        <div className="space-y-2 border-t border-line px-2.5 py-2">
          {call.recordingUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below IS the caption
            <audio controls preload="none" src={call.recordingUrl} className="w-full" />
          )}
          {call.transcript ? (
            <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink">
              {call.transcript}
            </p>
          ) : (
            <p className="text-[11.5px] italic text-muted">
              {call.transcriptStatus === "pending"
                ? "Transcribing…"
                : call.transcriptStatus === "failed"
                  ? "Transcription failed."
                  : "No transcript."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
