"use client";

import Link from "next/link";
import { Bell, BellOff, Volume2, VolumeX, MessageSquare } from "lucide-react";
import { useInboundAlerts } from "./InboundAlerts";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui";
import { fmtPhone } from "@/domain/format";

/**
 * Unread customer replies, live, from anywhere in the app.
 *
 * The bell used to be a mute switch and nothing else - it rang, and to find out
 * what had arrived you went looking. Now it shows what came in and goes
 * straight there, with the mute moved inside where it belongs.
 *
 * LIVE WITHOUT ITS OWN SUBSCRIPTION. InboundAlerts already listens for inbound
 * inserts and calls router.refresh(), which re-runs the layout that feeds this
 * list. One socket, one source of truth, and no chance of the bell and the
 * inbox disagreeing about what is unread.
 *
 * @param {{ notifications: Array<{id,phone,name,body,createdAt}>, unreadCount: number }} props
 */
export function NotificationBell({ notifications = [], unreadCount = 0 }) {
  const { soundOn, toggleSound, mutedBySetting } = useInboundAlerts();
  const has = unreadCount > 0;
  const silent = !soundOn || mutedBySetting;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={has ? `${unreadCount} unread messages` : "Notifications"}
          className="relative rounded-md p-1.5 text-muted transition-colors hover:bg-bg hover:text-ink"
        >
          <Bell size={17} className={has ? "text-ink" : undefined} />
          {has && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold text-white ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          {/* Muted is worth showing at a glance: someone who muted it a week ago
              and forgot has no other way to know why it stopped ringing. */}
          {silent && (
            <span className="absolute -bottom-0.5 -right-1 text-muted">
              <BellOff size={10} />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>{has ? `${unreadCount} unread` : "Notifications"}</span>
          {mutedBySetting ? (
            // The /settings switch outranks this browser's toggle, so offering
            // the toggle here would be a button that does nothing. Point at
            // where the mute lives instead (only admins are ever muted by it,
            // and they can open /settings). An ITEM so the menu closes on the
            // way there.
            <DropdownMenuItem
              asChild
              className="gap-1 px-1.5 py-1 text-[11px] font-semibold text-muted"
            >
              <Link href="/settings">
                <VolumeX size={12} /> Muted in Settings
              </Link>
            </DropdownMenuItem>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault(); // keep the menu open — this is a setting, not a destination
                toggleSound();
              }}
              aria-pressed={!soundOn}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted hover:bg-bg hover:text-ink"
            >
              {soundOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
              {soundOn ? "Sound on" : "Muted"}
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] italic text-muted">
            No unread replies.
          </p>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem key={n.id} asChild>
              {/* Opening the conversation is what marks it read, so this is a
                  link to the work rather than a dismiss button. */}
              <Link
                href={`/messages?phone=${n.phone}`}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{n.name}</span>
                  {/* "2m" on the server can be "3m" by the time it hydrates.
                      The drift is the point of a relative time, not a bug. */}
                  <span suppressHydrationWarning className="flex-shrink-0 text-[10.5px] text-muted">
                    {relativeTime(n.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[12px] text-muted">
                  {n.body || fmtPhone(n.phone)}
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/messages" className="justify-center text-[12.5px] font-semibold text-accent">
            <MessageSquare size={13} /> Open inbox
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "4m", "2h", "3d" — a timestamp is more precision than a glance needs. */
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
