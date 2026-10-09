import { Card, PageTitle } from "@/components/ui";

/**
 * Honest placeholder for a nav section whose UI hasn't been ported from the
 * original single-file prototype yet. The data model and routing are already
 * in place — these are the screens still to build.
 */
export function ComingSoon({ title, children }) {
  return (
    <div className="max-w-2xl">
      <PageTitle>{title}</PageTitle>
      <Card className="text-[13.5px] leading-relaxed text-muted">
        <p className="mb-1 font-semibold text-ink">Not ported yet.</p>
        {children}
      </Card>
    </div>
  );
}
