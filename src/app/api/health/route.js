import { json, handle } from "@/lib/api";
import { isSmsTestMode } from "@/lib/twilio/client";
import { isSickwTestMode } from "@/lib/sickw/client";

export const GET = handle(async () => {
  return json({ ok: true, smsTestMode: isSmsTestMode(), sickwTestMode: isSickwTestMode() });
});
