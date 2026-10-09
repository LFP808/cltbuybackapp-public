import Link from "next/link";
import { SearchX } from "lucide-react";
import { Card, Button } from "@/components/ui";

/**
 * The employee surface's 404 — reached by stale links and probed ids, because
 * scope refuses out-of-scope ids with notFound() rather than an error (see
 * lib/repositories/scope.js: probing an id must reveal nothing about whether
 * it exists).
 *
 * Without this file that landed on Next's bare "404 | This page could not be
 * found" — which, on a phone, reads as the app having broken, and looks
 * identical to the stale-chunk build trap the team already chases.
 *
 * Deliberately says "isn't available to you" and offers no detail: the copy is
 * the same whether the order never existed or belongs to someone else, so the
 * page discloses exactly as little as the repository does.
 */
export default function EmployeeNotFound() {
  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <SearchX size={22} className="text-muted" />
          <h1 className="font-serif text-xl text-ink">
            This isn&apos;t available to you
          </h1>
          <p className="text-[13.5px] text-muted">
            The page or order may have been reassigned, cancelled, or never existed. Nothing is
            wrong with the app.
          </p>
          <div className="mt-1 flex gap-2">
            <Button as={Link} href="/calendar" size="sm">
              Today&apos;s stops
            </Button>
            <Button as={Link} href="/" variant="ghost" size="sm">
              Dashboard
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
