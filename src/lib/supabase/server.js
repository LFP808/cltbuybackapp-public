import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Bound to the request's cookies so the user's session (and therefore RLS)
 * applies. Uses the public key — never the service role.
 *
 * Publishable is the new name for the anon key; both are read so one build
 * runs against the hosted project and the local stack alike. Keep this pair in
 * step with client.js and middleware.js — when only one of the three was
 * moved to the new name, every request 500'd with "Your project's URL and Key
 * are required" because the other two resolved to undefined.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore — middleware refreshes the session cookie.
          }
        },
      },
    },
  );
}
