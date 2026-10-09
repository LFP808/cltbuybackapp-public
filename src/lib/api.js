import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth";

/** JSON response helper. */
export function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Ensure the caller is signed in. Returns the user, or throws an ApiError(401)
 * that route handlers convert into a 401 response.
 *
 * This proves only that SOMEBODY is signed in. If the handler does anything a
 * role could be refused — spending money, texting a customer, reading config —
 * use requireApiStaff() and check the role. Stopping at requireUser once let
 * a restricted role reach endpoints their server-action equivalents refused.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError("Not authenticated.", 401);
  return user;
}

/**
 * The signed-in staff member ({ id, name, role }), or an ApiError(401).
 *
 * The API-route counterpart to requireStaff(): same guarantee, but it throws
 * the ApiError that `handle` turns into a clean 401 instead of a 500. Callers
 * then gate on the role using the same domain/access.js predicates the server
 * actions use, so an endpoint and its action equivalent can't drift apart.
 */
export async function requireApiStaff() {
  const staff = await getCurrentStaff();
  if (!staff.id) throw new ApiError("Not authenticated.", 401);
  return staff;
}

/** Wrap a route handler so thrown ApiError / errors become clean JSON. */
export function handle(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      const status = err?.status || 500;
      const message = err?.message || "Unexpected server error.";
      if (status >= 500) console.error(err);
      // `details` lets a handled error carry structured context the UI can
      // act on, beyond the one-line message.
      return json({ error: message, ...(err?.details ? { details: err.details } : {}) }, status);
    }
  };
}

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
