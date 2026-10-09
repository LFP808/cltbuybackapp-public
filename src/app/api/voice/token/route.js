import { json, handle, ApiError } from "@/lib/api";
import { getCurrentStaff } from "@/lib/auth";
import { voiceAccessToken, isVoiceConfigured } from "@/lib/twilio/access-token";
import { canContactCustomers } from "@/domain/access";

/**
 * Mint a Voice access token for the signed-in staff member's softphone.
 *
 * The identity is their profile id, taken from the SESSION — never from the
 * request. A client that could name its own identity could register as someone
 * else and take their calls.
 *
 * Which numbers a caller may dial is decided in /api/voice/outbound, where
 * the destination is actually known — a token can only say "may place calls",
 * not "may place this call".
 */
export const GET = handle(async () => {
  const staff = await getCurrentStaff();
  if (!staff.id) throw new ApiError("Not authenticated.", 401);
  if (!isVoiceConfigured()) throw new ApiError("Voice is not configured.", 503);

  const handlesCustomers = canContactCustomers(staff.role);
  if (!handlesCustomers) {
    throw new ApiError("Not allowed to use the phone.", 403);
  }

  return json({
    token: voiceAccessToken({ identity: staff.id, canReceive: handlesCustomers }),
    identity: staff.id,
    name: staff.name,
    canReceive: handlesCustomers,
  });
});
