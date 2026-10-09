"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Inbox, Phone, Megaphone } from "lucide-react";
import { Card, Button, Badge, EmptyState, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtPhone } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { INQUIRY_STATUSES, describeAdSource } from "@/domain/device-inquiries";
import { contactRestriction } from "@/domain/contact-status";
import { MessageThread } from "@/components/employee/messages/MessageThread";
import { Composer } from "@/components/employee/messages/Composer";
import { ContactRestrictionNotice } from "@/components/employee/ContactRestrictionNotice";
import { markReadAction } from "@/app/employee/messages/actions";
import {
  updateDeviceInquiryAction,
  getLeadThreadAction,
  sendLeadReplyAction,
} from "@/app/employee/leads/actions";

const STATUS_LABEL = { new: "New", contacted: "Contacted", closed: "Closed" };
const STATUS_TONE = {
  new: "bg-accent-l text-accent",
  contacted: "bg-status-awaiting-bg text-status-awaiting",
  closed: "bg-status-paid-bg text-status-paid",
};
const FILTERS = ["all", ...INQUIRY_STATUSES];

/** YYYY-MM-DD HH:mm epoch -> "Jul 12, 3:40 PM". */
function fmtWhen(ms) {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The leads triage list: filter by status, expand a row to work it — reply
 * right there with the full SMS thread, then change status and leave a
 * note. The first reply auto-advances a "new" lead to "contacted" (see
 * sendLeadReplyAction); messaging stays available regardless of status.
 */
export function LeadsManager({ inquiries, messagingOff = false }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("new");
  const [openId, setOpenId] = useState(null);
  const [draftStatus, setDraftStatus] = useState("new");
  const [draftNotes, setDraftNotes] = useState("");
  const [error, setError] = useState("");

  // One slot — only one row is ever expanded at a time. null while collapsed;
  // { phone, messages, smsOptedOut, statusUnknown, loading } while open.
  const [activeThread, setActiveThread] = useState(null);
  // Guards against re-marking the same phone read on every click inside the
  // thread this session, same reason CustomerDetail keeps one.
  const markedPhonesRef = useRef(new Set());

  const counts = useMemo(() => {
    const c = { all: inquiries.length, new: 0, contacted: 0, closed: 0 };
    for (const inquiry of inquiries) c[inquiry.status] = (c[inquiry.status] || 0) + 1;
    return c;
  }, [inquiries]);

  const filtered = useMemo(
    () => (filter === "all" ? inquiries : inquiries.filter((i) => i.status === filter)),
    [inquiries, filter],
  );

  async function loadThread(inquiry) {
    const { ok, error: err, result } = await runAction(() => getLeadThreadAction(inquiry.phone));
    setActiveThread({
      phone: inquiry.phone,
      messages: ok ? result.messages : [],
      smsOptedOut: ok ? result.smsOptedOut : false,
      statusUnknown: ok ? result.statusUnknown : true,
      loading: false,
      loadError: ok ? "" : err,
    });
  }

  function openRow(inquiry) {
    setError("");
    setOpenId(inquiry.id);
    setDraftStatus(inquiry.status);
    setDraftNotes(inquiry.notes || "");
    setActiveThread({
      phone: inquiry.phone,
      messages: [],
      smsOptedOut: false,
      statusUnknown: false,
      loading: true,
    });
    void loadThread(inquiry);
  }

  function closeRow() {
    setOpenId(null);
    setActiveThread(null);
  }

  // Fires on real interaction with the thread (click, keypress, focus) or on
  // sending — never just on expanding a row. Mirrors CustomerDetail exactly:
  // glancing at a lead must not silently clear the main inbox's unread badge.
  const markRead = useCallback(() => {
    if (!activeThread) return;
    const { phone, messages } = activeThread;
    const hasUnread = messages.some((m) => m.direction === "inbound" && !m.readAt);
    if (!hasUnread || markedPhonesRef.current.has(phone)) return;
    markedPhonesRef.current.add(phone);
    markReadAction(phone)
      .then(() => router.refresh())
      .catch(() => {});
  }, [activeThread, router]);

  async function sendReply(inquiry, text, image) {
    const { ok, error: err } = await runAction(() =>
      sendLeadReplyAction(inquiry.id, inquiry.phone, text, image),
    );
    if (!ok) throw new Error(err);
    markRead();
    void loadThread(inquiry);
    router.refresh();
  }

  function save(id) {
    startTransition(async () => {
      const result = await updateDeviceInquiryAction({ id, status: draftStatus, notes: draftNotes });
      if (result?.error) {
        setError(result.error);
        return;
      }
      closeRow();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-lg border border-line p-0.5">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              filter === key ? "bg-accent text-white" : "text-muted hover:text-ink",
            )}
          >
            {key === "all" ? "All" : STATUS_LABEL[key]} ({counts[key] || 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox}>No leads in this view.</EmptyState>
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {filtered.map((inquiry) => {
              const open = openId === inquiry.id;
              const adSource = describeAdSource(inquiry.adParams);
              return (
                <div key={inquiry.id} className="py-2">
                  <button
                    type="button"
                    onClick={() => (open ? closeRow() : openRow(inquiry))}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                  >
                    <span className="w-32 flex-shrink-0 text-[12.5px] text-muted">
                      {fmtWhen(inquiry.createdAt)}
                    </span>
                    <Badge className={STATUS_TONE[inquiry.status]}>
                      {STATUS_LABEL[inquiry.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {inquiry.model || inquiry.brand || "Device"} — {inquiry.name}
                    </span>
                    <span className="flex items-center gap-1 text-[13px] text-muted">
                      <Phone size={12} /> {fmtPhone(inquiry.phone)}
                    </span>
                    {adSource && (
                      <span
                        className="flex items-center gap-1 text-[12px] font-medium text-accent"
                        title={inquiry.adParams}
                      >
                        <Megaphone size={15} /> {adSource}
                      </span>
                    )}
                  </button>

                  {open && (
                    <div className="mt-3 space-y-3 rounded-lg bg-bg p-3">
                      {inquiry.deviceSummary && (
                        <p className="whitespace-pre-wrap text-[13px] text-ink">
                          {inquiry.deviceSummary}
                        </p>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-medium text-ink">Conversation</span>
                          <Link
                            href={`/messages?phone=${inquiry.phone}`}
                            className="text-[12px] font-semibold text-accent"
                          >
                            View in Messages →
                          </Link>
                        </div>
                        <div
                          className="max-h-64 overflow-y-auto rounded-lg border border-line bg-white p-2"
                          onPointerDown={markRead}
                          onKeyDownCapture={markRead}
                          onFocusCapture={markRead}
                        >
                          {activeThread?.loading ? (
                            <div className="flex items-center justify-center py-6">
                              <Spinner size={20} label="Loading conversation" />
                            </div>
                          ) : activeThread?.loadError ? (
                            <p className="py-4 text-center text-[13px] text-red-500">
                              {activeThread.loadError}
                            </p>
                          ) : (
                            <MessageThread messages={activeThread?.messages || []} />
                          )}
                        </div>
                        {activeThread && !activeThread.loading && (
                          <>
                            <ContactRestrictionNotice contact={{ ...activeThread, messagingOff }} />
                            {contactRestriction({ ...activeThread, messagingOff })?.canText !==
                              false && (
                              <Composer onSend={(text, image) => sendReply(inquiry, text, image)} />
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[13px] font-medium text-ink">Status</span>
                          <select
                            className="h-9 rounded-lg border border-line bg-white px-3 text-[14px]"
                            value={draftStatus}
                            onChange={(e) => setDraftStatus(e.target.value)}
                          >
                            {INQUIRY_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="min-w-[220px] flex-1">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[13px] font-medium text-ink">Notes</span>
                            <textarea
                              rows={2}
                              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[14px] text-ink shadow-xs outline-none placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
                              placeholder="What happened? (optional)"
                              value={draftNotes}
                              onChange={(e) => setDraftNotes(e.target.value)}
                            />
                          </label>
                        </div>
                        <Button disabled={pending} onClick={() => save(inquiry.id)}>
                          Save
                        </Button>
                      </div>
                      {error && <p className="text-[13px] text-red-500">{error}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
