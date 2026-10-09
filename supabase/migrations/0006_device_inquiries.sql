-- Device inquiries: the "sell your device" quote wizard on the marketing
-- site used to POST straight to Formspree, so nobody saw a submission
-- anywhere but Formspree's own inbox. It now POSTs to /api/device-inquiries
-- (an unauthenticated route, service-role insert — see that file) and lands
-- here, where staff triage it on /leads.
--
-- Flat columns, not jsonb: the wizard already flattens a multi-device
-- submission into pipe-joined strings and one device_summary text block
-- before it submits, so there's no structured per-device shape arriving over
-- the wire, and the triage view never queries into per-device facts.
create table if not exists public.device_inquiries (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text not null,
  sms_consent    boolean not null default false,
  source_page    text,
  ad_params      text,
  brand          text,
  model          text,
  carrier        text,
  condition      text,
  issues         text,
  sell_method    text,
  item_count     integer not null default 1,
  device_summary text,
  status         text not null default 'new',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists device_inquiries_status_idx on public.device_inquiries (status);
create index if not exists device_inquiries_created_idx on public.device_inquiries (created_at desc);

alter table public.device_inquiries enable row level security;

-- Both roles triage leads (same job as answering texts/calls), unlike the
-- admin-only money tables above.
create policy device_inquiries_staff_all on public.device_inquiries
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Grants are already schema-wide (section 17 of 0001_init.sql) — nothing
-- further needed here, same as every other staff table.

-- Realtime: the /leads bell subscribes to inserts. Same conditional-add
-- pattern as 0001_init.sql's section 16, so re-running this migration (or an
-- environment where it's already applied) stays a no-op.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_inquiries'
  ) then
    alter publication supabase_realtime add table public.device_inquiries;
  end if;
end $$;
