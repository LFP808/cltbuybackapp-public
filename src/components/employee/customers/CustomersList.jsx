"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus, Users, Package, DollarSign, Trash2 } from "lucide-react";
import { Card, Button, Badge, EmptyState, Modal, DialogFooter } from "@/components/ui";
import { runAction } from "@/lib/run-action";
import { deleteContactAction } from "@/app/employee/customers/actions";
import { cn } from "@/lib/cn";
import { fmtPhone, currency } from "@/domain/format";
import { timeAgoShort } from "@/domain/thread";
import { AddCustomerForm } from "./AddCustomerForm";
import { KindFlair } from "./KindFlair";
import { KIND_FILTERS, matchesKindFilter } from "@/domain/customer-kind";

/**
 * Searchable, tag-segmentable customer directory. Server provides the
 * aggregated list; filtering is pure client interactivity.
 */
export function CustomersList({ customers, tags, canDelete = false }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The contact a delete confirmation is open for, and the refusal to show
  // inside it - the money guards answer here, not as a page error.
  const [deleting, setDeleting] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError("");
    const outcome = await runAction(() => deleteContactAction(deleting.phone));
    setDeleteBusy(false);
    if (!outcome.ok) {
      setDeleteError(outcome.error);
      return;
    }
    setDeleting(null);
    router.refresh();
  }
  const [activeTag, setActiveTag] = useState(null);
  // Separate from the tag segment, and deliberately ANDed with it: "local
  // customers tagged wholesale" is a real question, and one shared slot would
  // have made the two mutually exclusive for no reason.
  const [activeKind, setActiveKind] = useState(null);
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false;
      if (activeKind && !matchesKindFilter(c.kind, activeKind)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, ""));
    });
  }, [customers, query, activeTag, activeKind]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border-[1.5px] border-line bg-white px-3 py-2">
          <Search size={16} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone…"
            className="flex-1 bg-transparent text-[13.5px] outline-none"
          />
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add customer
        </Button>
      </div>

      {/* How they reach us, above the hand-typed tags. KIND_FILTERS is empty
          while there is only one kind of handover worth filtering by — the
          row renders nothing rather than a lone "Everyone" chip, and comes
          back on its own if a filter earns its place again. */}
      {KIND_FILTERS.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <SegmentChip active={!activeKind} onClick={() => setActiveKind(null)}>
            Everyone
          </SegmentChip>
          {KIND_FILTERS.map((f) => (
            <SegmentChip
              key={f.key}
              active={activeKind === f.key}
              onClick={() => setActiveKind(activeKind === f.key ? null : f.key)}
            >
              {f.label}
            </SegmentChip>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <SegmentChip active={!activeTag} onClick={() => setActiveTag(null)}>
            All
          </SegmentChip>
          {tags.map((t) => (
            <SegmentChip key={t} active={activeTag === t} onClick={() => setActiveTag(t)}>
              {t}
            </SegmentChip>
          ))}
        </div>
      )}

      <div className="mb-3 text-[12px] text-muted">
        {filtered.length} customer{filtered.length === 1 ? "" : "s"}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Users}>
            {customers.length === 0
              ? "No customers yet. They appear here after their first order or message."
              : "No customers match."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((c) => (
            <Link key={c.phone} href={`/customers/${c.phone}`}>
              <Card className="relative flex h-full items-start gap-3 p-4 transition-colors hover:border-accent">
                {/* Inside the Link on purpose - a separate column would cost
                    the whole-card click - so it must swallow the navigation. */}
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Delete ${c.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteError("");
                      setDeleting(c);
                    }}
                    className="absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent font-serif text-[15px] text-white">
                  {c.initial}
                  {c.unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-received px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-bold text-ink">{c.name}</span>
                    {/* Same reason as the inbox list: timeAgoShort reads
                        Date.now(), so server and client legitimately disagree
                        across a minute boundary and React would otherwise log a
                        hydration error and regenerate the list. */}
                    <span
                      suppressHydrationWarning
                      className="flex-shrink-0 text-[10.5px] text-muted"
                    >
                      {timeAgoShort(c.lastActivity)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] text-muted">{fmtPhone(c.phone)}</span>
                    <KindFlair kind={c.kind} title={c.kindDetail} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Package size={12} /> {c.shipmentCount} order
                      {c.shipmentCount === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <DollarSign size={12} /> {currency(c.totalPaid)} paid
                    </span>
                  </div>

                  {c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-[10.5px] text-muted">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <AddCustomerForm open={adding} onClose={() => setAdding(false)} />

      <Modal
        open={Boolean(deleting)}
        onClose={() => (deleteBusy ? null : setDeleting(null))}
        title={`Delete ${deleting?.name || "this contact"}?`}
      >
        <div className="space-y-3">
          <p className="text-[13px] text-ink">
            Removes them everywhere: open orders, the message thread, call history, and notes. There
            is no undo.
          </p>
          <p className="text-[12px] text-muted">
            Contacts with received or paid orders can&apos;t be deleted — those are money records. A
            customer who wants no more texts should get the opt-out, not erasure.
          </p>
          {deleteError && <p className="text-[12.5px] text-red-600">{deleteError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Keep them
            </Button>
            <Button disabled={deleteBusy} onClick={confirmDelete}>
              {deleteBusy ? "Deleting…" : "Delete contact"}
            </Button>
          </DialogFooter>
        </div>
      </Modal>
    </div>
  );
}

function SegmentChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-[12px] font-semibold transition-colors",
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-white text-muted hover:border-accent",
      )}
    >
      {children}
    </button>
  );
}
