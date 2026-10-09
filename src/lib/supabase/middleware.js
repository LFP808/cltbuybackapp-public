import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { normalizeRole, NO_ACCESS_ROLE } from "@/domain/roles";
import {
  checkSessionWindow,
  IDLE_COOKIE,
  START_COOKIE,
  IDLE_COOKIE_OPTIONS,
  START_COOKIE_OPTIONS,
} from "@/lib/session-window";

/**
 * Refreshes the Supabase auth session on every request and returns the
 * (possibly cookie-updated) response, the resolved user, and their role. The
 * root middleware uses both to gate employee routes.
 *
 * @param {import('next/server').NextRequest} request
 */
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  // Publishable is the new name for the anon key; both are read so one build
  // runs against the hosted project and the local stack alike. This is the
  // costliest of the three to get wrong: middleware runs on EVERY request, so
  // an unresolved key here 500s the whole site rather than one page.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // --- session window -------------------------------------------------------
  // Supabase renews a session forever: the refresh token rotates and every
  // request buys another hour. The idle window and the daily ceiling are
  // enforced here because there is nowhere else they exist. See
  // lib/session-window.js.
  if (user) {
    const { expired, start } = await checkSessionWindow({
      idle: request.cookies.get(IDLE_COOKIE)?.value,
      start: request.cookies.get(START_COOKIE)?.value,
    });

    if (expired) {
      // Really ended, not just redirected away from: this revokes the refresh
      // token, so the dead session cannot be resurrected by going back.
      await supabase.auth.signOut().catch(() => {});
      response.cookies.delete(IDLE_COOKIE);
      response.cookies.delete(START_COOKIE);
      return { response, user: null, role: null, expired };
    }

    // Every authenticated request pushes the idle window out again. The cookie
    // does the counting - its maxAge IS the window - so there is no clock here
    // to be wrong about.
    response.cookies.set(IDLE_COOKIE, "1", IDLE_COOKIE_OPTIONS());
    if (start) response.cookies.set(START_COOKIE, start, START_COOKIE_OPTIONS());
  }

  // The role is fetched here rather than in the page because the gate has to
  // run before anything renders. It costs one indexed primary-key lookup per
  // request; if that ever shows up in latency, mirror the role into the JWT's
  // app_metadata on profile change and read it off the session instead.
  let role = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    // The OTHER place a role enters the app (see lib/auth.js). Both normalize,
    // so the middleware gate and the page's own checks can never disagree about
    // whether an unmigrated "staff" row is a VA — and both fall back to the
    // role that opens nothing, so an account with no profile row is stopped
    // HERE, at the gate, rather than deep in a page that trusted the guess.
    role = normalizeRole(profile?.role) || NO_ACCESS_ROLE;
  }

  return { response, user, role, expired: null };
}
