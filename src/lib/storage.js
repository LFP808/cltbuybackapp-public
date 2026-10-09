import { createAdminClient } from "@/lib/supabase/admin";

/** Created by supabase/migrations/0004_mms_bucket.sql; public, images only. */
export const MMS_BUCKET = "mms";

/**
 * The bucket does not exist on this Supabase project.
 *
 * Its own class because the fix is on the project, not the photo: the send
 * action used to fold this into "try a smaller photo", and people resized
 * pictures for weeks against a bucket that was never created.
 */
export class MmsBucketMissingError extends Error {
  constructor() {
    super(
      `Photo storage is not set up: the "${MMS_BUCKET}" bucket is missing on this Supabase ` +
        "project. Run supabase/migrations/0004_mms_bucket.sql in its SQL editor.",
    );
    this.name = "MmsBucketMissingError";
  }
}

/** Upload a raw buffer to the public MMS bucket and return its public URL. */
export async function uploadToMms(buffer, mimeType) {
  const supabase = createAdminClient();
  const ext = (mimeType || "image/jpeg").split("/")[1]?.split("+")[0] || "jpg";
  const filename = `${Date.now()}-${randomToken()}.${ext}`;

  const { error } = await supabase.storage.from(MMS_BUCKET).upload(filename, buffer, {
    contentType: mimeType || "image/jpeg",
    upsert: false,
  });
  if (error) {
    // Storage's exact wording for a bucket that was never created.
    if (/bucket not found/i.test(error.message || "")) throw new MmsBucketMissingError();
    throw new Error(`Failed to store image: ${error.message}`);
  }

  const { data } = supabase.storage.from(MMS_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * Persist a base64 image (outbound MMS) to Supabase Storage and return a public
 * URL Twilio can fetch. Replaces the original server's local /uploads folder,
 * which does not survive on serverless hosts. Requires a public bucket "mms".
 */
export async function saveImageAndGetUrl(base64Data, mimeType) {
  const buffer = Buffer.from(base64Data.replace(/^data:.*;base64,/, ""), "base64");
  return uploadToMms(buffer, mimeType);
}

/**
 * Fetch a Twilio-hosted inbound media URL (which needs Basic auth and expires)
 * and re-host it publicly so the dashboard can display it without Twilio
 * credentials in the browser.
 */
export async function rehostRemoteMedia(url, { sid, token }) {
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Failed to fetch inbound media (${res.status}).`);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return uploadToMms(buffer, mimeType);
}

function randomToken() {
  return Math.random().toString(16).slice(2, 14);
}
