import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the current staff member out and return them to the login page. */
export async function POST(request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
