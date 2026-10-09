-- Admin "delete" of an order: KEEP THE RECORD, wipe the money and the stock.
--
-- Not a row delete. The row stays — name, phone, what they said they were
-- bringing, what was paid, the whole activity trail — because "this order
-- never happened" is itself something somebody will need to read later
-- ("didn't we buy from this guy in September?"). What goes is its effect on
-- the business: the order's lots are removed from inventory (and with them
-- its COG, its disposals and anything it would have earned), and the order
-- itself drops out of every money figure.
--
-- The money part needs no new column: the action flips `status` to
-- 'cancelled', and every money reader already excludes cancelled orders
-- (cash flow counts status = paid; the dashboard drops cancelled; the
-- check-in queue is received/paid only; the calendar, the appointment book
-- and the duplicate check all skip it). Piggybacking on that one established
-- exclusion beats teaching nine readers a second one they could each forget.
-- `deleted_at` is what tells a deleted order apart from an ordinary cancel in
-- the UI (displayStage returns "deleted"), and who/why complete the audit.
--
-- The lots are deleted outright, not flagged: a flagged lot is a lot every
-- grid, export and P/L read would have to remember to skip, and the IMEI's
-- unique index must come free so the same phone can be bought again for real.
-- The order's activity entry lists what was removed (item + IMEI), so the
-- record of what the devices were survives on the row that is kept.

alter table public.orders add column if not exists deleted_at    timestamptz;
alter table public.orders add column if not exists deleted_by    text;
alter table public.orders add column if not exists delete_reason text;

comment on column public.orders.deleted_at is
  'Admin deleted this order: the row is kept as a record, its lots were removed '
  'from inventory, and status was set to cancelled so no money screen counts it.';
comment on column public.orders.deleted_by is
  'Display name of the admin who deleted the order.';
comment on column public.orders.delete_reason is
  'Why it was deleted (required by the action) - the only explanation left later.';
