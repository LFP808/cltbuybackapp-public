"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Brandmark } from "@/components/ui";

/**
 * Staff login. Replaces the original "Who's working?" name box with real
 * Supabase email/password auth. Staff accounts are provisioned in Supabase
 * (or via an invite flow) — there is no public sign-up.
 *
 * useSearchParams (for the post-login redirect target) requires a Suspense
 * boundary during prerender, so the form lives in a child component.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const timedOut = {
    idle: "Signed out after an hour of inactivity. Sign in to pick up where you left off.",
    max: "Sessions end after a day. Sign in again to carry on.",
  }[params.get("timeout")];

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace(params.get("next") || "/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-5">
      {/* method="post" matters even though onSubmit always handles this.
          A <form> with no method defaults to GET, so if the JavaScript fails to
          load — a bad deploy, a stale chunk, a blocked script — the browser
          submits natively and puts the password in the URL:
            /login?email=someone%40example.com&password=hunter2
          which lands in browser history, proxy logs and the Referer header. The
          failure mode is rare; what it leaks is not recoverable. POST keeps the
          credentials in the body whatever happens to the JS. */}
      <form
        method="post"
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-card border-[1.5px] border-line bg-white p-8 text-center"
      >
        <Brandmark large className="mb-4" />
        <h1 className="mb-1 font-serif text-xl text-ink">Employee sign in</h1>
        {/* Why they are looking at this page. A session that ends on its own is
            otherwise indistinguishable from being signed out by somebody else,
            which is how a routine timeout gets reported as the app breaking. */}
        {timedOut ? (
          <p className="mb-6 rounded-lg bg-accent-l/40 px-3 py-2 text-[13px] text-ink">{timedOut}</p>
        ) : (
          <p className="mb-6 text-[13px] text-muted">
            Sign in to manage meetups, inventory, and payouts.
          </p>
        )}

        <div className="flex flex-col gap-3 text-left">
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}

        <Button type="submit" className="mt-5 w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
