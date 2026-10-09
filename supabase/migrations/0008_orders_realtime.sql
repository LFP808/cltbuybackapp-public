-- Realtime: the calendar's day view subscribes to order changes (new
-- bookings, reschedules, cancellations) so it updates live instead of only
-- on the next navigation. Same conditional-add pattern as 0001_init.sql's
-- section 16 and 0006_device_inquiries.sql, so re-running this migration (or
-- an environment where it's already applied) stays a no-op.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
