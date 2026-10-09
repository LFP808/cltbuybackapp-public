import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components (the browser). Reads the public
 * key, so every query is subject to row-level security.
 *
 * Supabase renamed its API keys: the "anon key" is now the "publishable key".
 * Both names are read here — the hosted project hands us the new one, while
 * `supabase status` on the local stack still prints the old one — so a single
 * build runs in both. Written out longhand rather than looked up by name
 * because NEXT_PUBLIC_* values are inlined at BUILD time by literal textual
 * substitution; a computed `process.env[x]` is never substituted and would
 * reach the browser as undefined. Same reason the fallback lives in all three
 * client files instead of a shared helper's re-export.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
