"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/lib/use-realtime";
import { chime } from "@/lib/chime";

/**
 * Live leads: chimes and refreshes server data when a new device inquiry
 * lands from the marketing site's quote wizard.
 *
 * A sibling of InboundAlerts rather than folded into it — that component's
 * mute preference and chime are scoped to the customer-message stream, and
 * mixing a second notification source into it would muddy both. Mounted once
 * in the employee shell so the alert follows staff around the app, same
 * reasoning as InboundAlerts.
 *
 * `muted` is the /settings "mute for admins" switch, the one mute that does
 * reach this chime. Sound only — the refresh still runs, so the Leads badge
 * keeps counting.
 */
export function LeadAlerts({ enabled = true, muted = false }) {
  const router = useRouter();
  const audioRef = useRef(null);

  useRealtime({
    channel: "lead-inquiries",
    table: "device_inquiries",
    event: "INSERT",
    enabled,
    onChange: useCallback(() => {
      if (!muted) void chime(audioRef);
      router.refresh();
    }, [router, muted]),
  });

  return null;
}
