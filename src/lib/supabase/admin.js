import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES row-level security — use only in
 * trusted server code (never import into a Client Component).
 *
 * Legitimate users are session-less server jobs: the sweeps, the Twilio
 * webhooks, the digest. Each runs a narrow, purpose-built query, so the
 * underlying tables can stay fully private to `anon`.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // "Secret key" is Supabase's new name for the service-role key. Read both,
  // for the same reason the public key is read under both of its names — but
  // note neither is NEXT_PUBLIC_, so neither is ever shipped to a browser.
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
