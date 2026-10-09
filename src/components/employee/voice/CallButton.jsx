"use client";

import { Phone } from "lucide-react";
import { useVoice } from "./Softphone";
import { Button } from "@/components/ui";
import { fmtPhone } from "@/domain/format";

/**
 * Dial a customer from the browser.
 *
 * Renders nothing when the softphone isn't registered. A call button that
 * silently does nothing is worse than no button - it reads as the app being
 * broken rather than the phone not being set up - and on a page like this
 * there is always a phone number on screen to dial by hand instead.
 */
export function CallButton({ phone, className, variant = "ghost", size = "sm", label }) {
  const { call, ready } = useVoice();
  if (!ready || !phone) return null;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => call(phone)}
      aria-label={`Call ${fmtPhone(phone)}`}
    >
      <Phone size={15} /> {label ?? "Call"}
    </Button>
  );
}
