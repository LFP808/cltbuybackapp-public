import { NextResponse } from "next/server";

/**
 * Helpers for the Twilio Voice call-forwarding webhooks. The business number
 * (same one used for texts) forwards incoming calls to a personal cell, shown
 * with the business number as caller ID.
 */

export function voiceConfig() {
  return {
    businessNumber: toE164(process.env.TWILIO_FROM_NUMBER),
    forwardTo: toE164(process.env.TWILIO_FORWARD_TO_NUMBER),
    // Calls are recorded. The spoken warning is OFF by default because North
    // Carolina is a one-party-consent state and this is a North Carolina
    // business. It is a single flag because that stops being true the moment a
    // caller is in California, Florida, Pennsylvania, Washington or any other
    // all-party state - set VOICE_ANNOUNCE_RECORDING=true and every call opens
    // with the notice.
    announceRecording: process.env.VOICE_ANNOUNCE_RECORDING === "true",
    recordingNotice:
      process.env.VOICE_RECORDING_NOTICE ||
      "This call may be recorded for quality and training purposes.",
  };
}

/** Absolute base URL for building callback URLs Twilio will request next. */
export function baseUrl(request) {
  if (process.env.TWILIO_VOICE_BASE_URL)
    return process.env.TWILIO_VOICE_BASE_URL.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  return `${proto}://${host}`;
}

/** The exact URL Twilio signed for a given path (for signature validation). */
export function webhookUrl(request, path) {
  return `${baseUrl(request)}${path}`;
}

/** Wrap TwiML in a proper XML response. */
export function twiml(inner) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Escape a string for safe inclusion in XML attributes / text. */
export function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toE164(n) {
  if (!n) return "";
  const s = String(n).trim();
  if (s.startsWith("+")) return s;
  const d = s.replace(/\D/g, "");
  return d.length === 10 ? `+1${d}` : d ? `+${d}` : "";
}
