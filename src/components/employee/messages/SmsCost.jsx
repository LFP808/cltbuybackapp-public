"use client";

import { AlertCircle } from "lucide-react";
import { smsCost, nonGsmCharacters } from "@/domain/sms";
import { cn } from "@/lib/cn";

/** Render a character so a space or invisible glyph is still identifiable. */
const quote = (ch) => `"${ch}"`;

/**
 * What this message will cost to send.
 *
 * Carriers bill per segment, and ONE character outside GSM-7 — an em dash, a
 * curly quote pasted from a document, an emoji — re-encodes the whole message
 * as UCS-2, cutting a segment from 153 characters to 67 and roughly doubling
 * the bill. Nothing else in the app surfaces that; it shows up on the Twilio
 * invoice weeks later.
 *
 * Shared because it was NOT shared: the inbox and the customer page had this
 * meter while the order page and the simple thread had their own hand-rolled
 * composers without it, so the same pasted quote was warned about on two
 * screens and silent on the other two.
 */
export function SmsCost({ text, className }) {
  const cost = smsCost(text);
  const offenders = cost.encoding === "UCS-2" ? nonGsmCharacters(text) : [];
  if (!text?.length) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 self-end text-[11px] text-muted",
        className,
      )}
    >
      <span>
        {cost.units} char{cost.units === 1 ? "" : "s"} · {cost.segments} segment
        {cost.segments === 1 ? "" : "s"}
      </span>
      {cost.encoding === "UCS-2" && (
        <span className="flex items-center gap-1 rounded-pill bg-status-awaiting-bg px-2 py-0.5 font-semibold text-status-awaiting">
          <AlertCircle size={11} />
          {offenders.length > 0 ? (
            <>Costs double because of {offenders.slice(0, 3).map(quote).join(" ")}</>
          ) : (
            <>Costs double (Unicode)</>
          )}
        </span>
      )}
    </div>
  );
}
