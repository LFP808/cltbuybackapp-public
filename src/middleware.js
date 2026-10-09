import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { canAccess, homeFor } from "@/domain/access";

/**
 * Auth + clean URLs, on a single hostname.
 *
 * The staff surface lives under /employee in the source tree, but nobody
 * ever sees that prefix: this middleware rewrites bare paths (/customers)
 * to the internal route (/employee/customers), and any explicitly-typed
 * prefix is redirected back to the clean URL. (The DTS ancestor split two
 * hostnames across an employee app and a customer portal; CLT Buyback has
 * no customer-facing site, so the host check went with it.)
 */
export async function middleware(request) {
  const { response, user, role, expired } = await updateSession(request);
  const url = request.nextUrl;

  // A session that just ran out of window. updateSession has already revoked
  // it and cleared the markers; all that is left is to say so in the language
  // the caller speaks. Handled BEFORE the /api early return, or a timed-out
  // tab left polling would keep getting 200s off a session the app considers
  // over.
  if (expired) {
    if (url.pathname.startsWith("/api")) {
      const body = JSON.stringify({ error: "Session expired. Sign in again." });
      const refused = new NextResponse(body, {
        status: 401,
        headers: { "content-type": "application/json" },
      });
      response.cookies.getAll().forEach((c) => refused.cookies.set(c));
      return refused;
    }
    if (!isAuthPath(url.pathname)) {
      return redirectToLogin(request, response, { timeout: expired });
    }
  }

  // API routes and auth pages are never rewritten or gated here (each API
  // handler enforces its own access; /login must stay public).
  if (url.pathname.startsWith("/api")) return response;
  if (isAuthPath(url.pathname)) return response;

  // The internal prefix is an implementation detail, not an address.
  if (isPrefixed(url.pathname, "/employee")) {
    return redirectTo(request, stripPrefix(url.pathname, "/employee"), response);
  }

  if (!user) return redirectToLogin(request, response);

  // Role gate. Runs on the clean path, before the rewrite, so the rules in
  // domain/access.js are written against the URLs staff actually see.
  if (!canAccess(role, url.pathname)) {
    return redirectTo(request, homeFor(role), response);
  }

  return rewrite(request, `/employee${normalize(url.pathname)}`, response);
}

/**
 * Send someone to /login, carrying where they were headed and, when a session
 * ran out rather than never existing, why. Without the reason a timeout is
 * indistinguishable from being signed out by someone else, which is the kind
 * of thing people report as the app losing their work.
 */
function redirectToLogin(request, response, { timeout } = {}) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  if (timeout) loginUrl.searchParams.set("timeout", timeout);
  const redirect = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

function isAuthPath(pathname) {
  return pathname === "/login" || pathname.startsWith("/auth");
}

function isPrefixed(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function stripPrefix(pathname, prefix) {
  const rest = pathname.slice(prefix.length);
  return rest === "" ? "/" : rest;
}

function normalize(pathname) {
  return pathname === "/" ? "" : pathname;
}

function rewrite(request, pathname, baseResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const rewritten = NextResponse.rewrite(url, { request });
  baseResponse.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
  return rewritten;
}

function redirectTo(request, pathname, baseResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const redirect = NextResponse.redirect(url);
  baseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

export const config = {
  // Run on everything except static assets and the image optimizer.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
