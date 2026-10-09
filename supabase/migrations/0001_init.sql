-- =============================================================================
-- CLT Buyback — consolidated initial schema.
--
-- Fresh database for the electronics buyback business, ported from the dtsapp
-- schema (migrations 0001..0030) with everything mail-in dropped: no labels,
-- no tracking, no drivers, no reminders-about-unposted-boxes. Orders are
-- meetups only (type = 'office'); a walk-in is a meetup that skipped the
-- appointment. Inventory is one row per DEVICE (IMEI/serial), not per
-- expiration-dated box.
--
-- Design notes carried over:
--  * All operational data is "shared team data" — any active, role-holding
--    profile can read/write it (is_staff()). RLS grants NOTHING to anon, and a
--    self-signed-up account holds role 'pending', which opens no table.
--  * The money tables (expenses, balance_snapshots) are admin-only in the
--    DATABASE (is_admin()), not just in middleware — a signed-in VA can talk
--    to PostgREST directly with their JWT, and "the UI doesn't offer it" is
--    not a control. app_settings has a read policy and NO write policy at
--    all: settings writes go through the service role from admin-checked
--    server actions.
--  * Line items / activity live as JSONB on the order. They are always read
--    and written with their order and never queried independently, so a child
--    table would add joins for no benefit. Messages ARE a separate table
--    because they are also grouped by phone across the inbox, independent of
--    any one order.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. Profiles — one row per employee, linked to Supabase Auth.
-- =============================================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text not null default '',
  -- 'admin' | 'va' (src/domain/roles.js), or 'pending' for an account nobody
  -- has granted a role yet. 'pending' is the COLUMN DEFAULT on purpose: the
  -- trigger below creates a profile row for ANY auth.users insert, so a
  -- self-signup must arrive holding nothing. It is absent from ROUTE_ACCESS
  -- (fail-closed, opens no page) and from is_staff() (reads no table).
  role            text not null default 'pending',
  -- Where this person gets texted. Security-relevant: editing someone's phone
  -- redirects their notifications, so the trigger below guards it.
  phone           text,
  -- Offboarding switch. Deactivation also bans the auth user (repositories/
  -- profiles.js); this column is what the roster, the middleware AND is_staff()
  -- read, so a still-valid JWT on a departed laptop is refused by the database
  -- on its next statement, not when the token expires.
  active          boolean not null default true,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now()
);

comment on column public.profiles.role is
  'One of admin | va (see src/domain/roles.js), or "pending" for an account '
  'nobody has granted a role yet — the column default, so self-signups hold nothing.';

-- Automatically create a profile row when a new auth user is created. The row
-- it writes is inert (role 'pending'); the real hiring path (createTeamMember)
-- creates the user and then UPDATEs the role with the service key.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lock the security-relevant columns on profiles against self-service edits.
--
-- The `profiles_update_own` policy below lets a signed-in user update their own
-- row with NO column restriction — and role/active/phone live in that row.
-- Every gate in the app reads profiles.role, so a user who PATCHes their own
-- row to role='admin' through PostgREST walks through every door; one who
-- flips `active` back on undoes an offboarding.
--
-- A trigger rather than a narrower policy: RLS cannot express "may update this
-- row but not this column", and the legitimate writers (/team's actions, the
-- test-account script) all use the service role, which this trigger lets pass.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.role() is 'anon'/'authenticated' for browser PostgREST requests,
  -- 'service_role' for the server admin client, and NULL when run directly
  -- (SQL editor, psql) — direct access is already privileged, so only the
  -- browser-reachable roles are refused.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and (
       new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.phone is distinct from old.phone
     ) then
    raise exception 'Only an administrator can change roles, phone numbers, or access.';
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- =============================================================================
-- 2. Role helpers for RLS.
-- =============================================================================
-- Whether the caller is an admin.
--
-- SECURITY DEFINER so the policy can read `profiles` regardless of the caller's
-- own grants, and `search_path` pinned so the function cannot be tricked into
-- resolving `profiles` to something else. STABLE, not VOLATILE: it is one read
-- per statement, and marking it so lets the planner call it once rather than
-- per row.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

comment on function public.is_admin is
  'True when the current JWT belongs to an admin. Used by RLS on the money tables.';

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Whether the caller is an ACTIVE profile holding a real role. The gate on
-- every operational table: a 'pending' signup and a deactivated account both
-- fail it, so a login nobody granted is worth nothing even straight against
-- PostgREST with the anon key and a fresh JWT.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'va')
      and coalesce(p.active, true)
  );
$$;

comment on function public.is_staff is
  'True when the current JWT belongs to an active profile holding a real role. '
  'Used by RLS on every operational table. See src/domain/roles.js.';

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- =============================================================================
-- 3. Orders — meetups only.
-- =============================================================================
-- One order = one appointment (or walk-in) to buy devices from a person.
-- `items` is what they SAY they're bringing ("iPhone 15 Pro Max ×1") and
-- est_value the promise made against it; the exact devices land at check-in
-- as inventory_lots rows.
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  -- One value today. Kept as a constrained column rather than dropped because
  -- every query, scope and mapper already branches on it, and a future second
  -- kind of order (shipping to us again, say) is a constraint widen, not a
  -- schema hunt.
  type           text not null default 'office' check (type in ('office')),
  status         text not null default 'awaiting'
                   check (status in ('awaiting', 'received', 'paid', 'cancelled')),

  -- customer
  name           text not null,
  phone          text not null,          -- stored normalized (last 10 digits)

  -- contents / valuation (the promise; check-in records the reality)
  items          jsonb not null default '[]'::jsonb,
  est_value      numeric(10, 2),

  -- the appointment
  pickup_date    date,
  pickup_time    text,
  -- True when the customer turned up unannounced and the order was recorded
  -- after the handover, rather than booked in advance. NOT a fourth status —
  -- a walk-in IS a meetup that skipped the appointment, and whether anybody
  -- was expecting them is the one fact not derivable afterwards.
  walk_in        boolean not null default false,

  -- payout facts. paid_at is when the money actually left — distinct from
  -- created_at, which is when the order was taken. received_at is when the
  -- devices were handed over ("Bought").
  paid_amount    numeric(10, 2),
  payment_method text,
  paid_at        timestamptz,
  received_at    timestamptz,
  -- Why the amount paid differs from the agreed estimate (device graded lower,
  -- FMI on, blacklisted). Recorded so a smaller payment is explainable later.
  payout_reason  text,

  -- undo, and the reasons for it. cancelled is terminal like paid but means
  -- the opposite: this order is over and no money moved.
  cancel_reason     text,
  cancelled_at      timestamptz,
  -- What happened at a meetup that produced no devices: no_show |
  -- customer_cancelled. The order stays awaiting — a missed meetup is one to
  -- rebook, not a finished order.
  stop_outcome      text,
  stop_outcome_at   timestamptz,
  stop_outcome_note text,

  -- When the physical devices were counted into inventory. A FACT, not a
  -- status: the Pending Check-in queue derives from its absence
  -- (status in (received, paid) and no check-in).
  checked_in_at  timestamptz,

  -- Customer texted the PAUSE keyword: stop automated nudges (appointment
  -- reminders, review asks) while ordinary conversation keeps working.
  -- Deliberately app-level and distinct from carrier STOP.
  reminders_cancelled_at timestamptz,

  -- audit trail
  activity       jsonb not null default '[]'::jsonb,

  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.orders.walk_in is
  'True when the customer turned up unannounced and the order was recorded '
  'after the handover, rather than booked in advance. Always paired with type = ''office''.';
comment on column public.orders.stop_outcome is
  'Why a meetup produced no devices (no_show | customer_cancelled). The order '
  'stays awaiting - a missed meetup is one to rebook, not a finished order.';
comment on column public.orders.payout_reason is
  'Why the amount paid differs from the agreed estimate. Recorded so a smaller '
  'payment is explainable later.';

create index if not exists orders_phone_idx       on public.orders (phone);
create index if not exists orders_status_idx      on public.orders (status);
create index if not exists orders_created_at_idx  on public.orders (created_at desc);
create index if not exists orders_type_idx        on public.orders (type);
create index if not exists orders_paid_at_idx     on public.orders (paid_at desc);
create index if not exists orders_received_at_idx on public.orders (received_at desc);
-- Finding the meetups that need another attempt / a follow-up text.
create index if not exists orders_stop_outcome_idx
  on public.orders (stop_outcome_at desc)
  where stop_outcome is not null and status = 'awaiting';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- 4. Messages — the conversation log, keyed by phone.
-- =============================================================================
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,            -- normalized
  order_id     uuid references public.orders (id) on delete set null,
  body         text not null default '',
  media_url    text,
  auto         boolean not null default false,
  test_mode    boolean not null default false,
  sent_by      text,
  -- Role of the sender AT SEND TIME. Stored, not joined: what a thread records
  -- is what happened, so a later promotion must not rewrite old messages.
  sent_by_role text,
  direction    text not null default 'outbound'
                 check (direction in ('inbound', 'outbound')),
  -- Unread applies to inbound messages: read_at IS NULL means a customer reply
  -- nobody has opened yet. Outbound messages leave this null and ignore it.
  read_at      timestamptz,
  -- Twilio's message SID: dedupes retried webhook deliveries inbound, and lets
  -- a status callback find the row it belongs to outbound.
  provider_sid text,
  -- Twilio's own verdict (queued | sent | delivered | undelivered | failed),
  -- updated by the status webhook. Null means test mode or inbound. Accepted
  -- is not delivered — wrong numbers and carrier blocks fail afterwards.
  delivery_status text,
  -- Carrier error code when a message fails (e.g. 21610 = recipient opted
  -- out). Kept as text: it is diagnostic, not an enum.
  delivery_error  text,
  created_at   timestamptz not null default now()
);

comment on column public.messages.sent_by_role is
  'Role of the sender AT SEND TIME (admin|va). Historical, never backfilled from profiles.';

create index if not exists messages_phone_idx on public.messages (phone, created_at);
create unique index if not exists messages_provider_sid_key
  on public.messages (provider_sid)
  where provider_sid is not null;
-- Fast unread lookups for the inbox badges.
create index if not exists messages_unread_idx
  on public.messages (phone)
  where direction = 'inbound' and read_at is null;
create index if not exists messages_delivery_status_idx
  on public.messages (delivery_status)
  where delivery_status in ('failed', 'undelivered');
-- An unindexed FK is a defect that shows up once the table is big enough to
-- hurt: deleting an order, and "the messages for this order", both need it.
create index if not exists messages_order_id_idx
  on public.messages (order_id)
  where order_id is not null;

-- =============================================================================
-- 5. Manual customers — added by hand before any order exists.
-- =============================================================================
create table if not exists public.manual_customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,             -- normalized
  street      text,
  street2     text,
  city        text,
  state       text,
  zip         text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists manual_customers_phone_idx on public.manual_customers (phone);

-- =============================================================================
-- 6. Contact notes — the per-phone "what we know about this person" table.
-- =============================================================================
create table if not exists public.contact_notes (
  phone       text primary key,          -- normalized
  notes       text not null default '',
  tags        text[] not null default '{}',
  -- Corrected display name for this number. An OVERRIDE, not a replacement:
  -- orders keep the name they were taken under (that is what makes them
  -- evidence); when set this wins everywhere the customer is shown.
  name        text,
  -- Customer texted STOP: the carrier blocks us permanently and Twilio rejects
  -- every later send. Recording it makes that a known state instead of a
  -- generic failure staff keep retrying.
  sms_opted_out_at timestamptz,
  -- How this person found us ("Facebook ad", "Referral", ...). Captured once;
  -- answers "which ad spend is working", which the expense ledger can only ask.
  lead_source text,
  -- Standing payout preference and WHERE to send it (Zelle email, $cashtag,
  -- Venmo handle). The payout form defaults from these; the order still
  -- records what was actually used.
  preferred_payment_method text,
  payment_handle text,
  updated_at  timestamptz not null default now()
);

comment on column public.contact_notes.name is
  'Corrected display name for this number. Overrides the name derived from '
  'orders/manual_customers; null means use the derived one.';

-- =============================================================================
-- 7. Calls — one row per phone call, filled in as Twilio reports progress.
-- =============================================================================
-- Keyed by call_sid for the upsert: Twilio reports the same call several times
-- (ringing, answered, completed, recording ready, transcript ready) and each
-- report has to find the row the last one made.
create table if not exists public.calls (
  id             uuid primary key default gen_random_uuid(),
  call_sid       text unique not null,
  direction      text not null default 'inbound' check (direction in ('inbound', 'outbound')),

  -- Raw E.164, exactly as Twilio reported it, for support and debugging.
  from_number    text,
  to_number      text,
  -- The customer, normalised regardless of direction. Joins to messages.phone
  -- and orders.phone; deriving it once on write beats every reader working out
  -- whether to look at from_number or to_number.
  phone          text,

  -- Twilio's own vocabulary, kept verbatim rather than mapped: queued,
  -- ringing, in-progress, completed, busy, failed, no-answer, canceled.
  status         text not null default 'queued',
  answered_by    uuid references public.profiles (id) on delete set null,
  answered_name  text,
  -- True when the call ended up on the forwarding cell rather than in the app.
  to_voicemail   boolean not null default false,

  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  duration_secs  integer,

  recording_sid  text,
  recording_url  text,
  transcript     text,
  -- pending | ready | failed | skipped — so a missing transcript can be told
  -- apart from one that is still being written.
  transcript_status text,

  -- Voicemail rides its own columns rather than reusing recording_url: the
  -- call recording is a conversation two people had, a voicemail is a message
  -- nobody has heard yet, and the log has to tell them apart.
  voicemail_url    text,
  voicemail_sid    text,
  voicemail_secs   integer,
  -- Who cleared the missed call and when. Null = still needs somebody.
  -- Deliberately not a boolean: "Ana called them back at 10:14" answers the
  -- question a boolean leaves open.
  handled_at       timestamptz,
  handled_by       text,
  -- Stamped when the automatic "sorry we missed you" text goes out, so a
  -- retried webhook can't text the same caller twice.
  missed_texted_at timestamptz,

  created_at     timestamptz not null default now()
);

create index if not exists calls_phone_idx      on public.calls (phone, started_at desc);
create index if not exists calls_started_at_idx on public.calls (started_at desc);
-- The follow-up queue: unhandled inbound calls, oldest first.
create index if not exists calls_handled_idx    on public.calls (handled_at, started_at desc);

-- =============================================================================
-- 8. Buyers — the wholesalers/platforms we sell devices to.
-- =============================================================================
-- Deliberately not a CRM: a name for the dropdown, an address for the printed
-- invoice's bill-to/ship-to, and the terms block (ACH details) that goes at
-- the bottom of the document.
create table if not exists public.buyers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  street      text,
  street2     text,
  city        text,
  state       text,
  zip         text,
  terms       text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- 9. Invoices.
-- =============================================================================
-- `number` is a plain integer sequence (INV-0001 is formatting, not storage).
-- Seeded at 1 so the first invoice is #1. A voided invoice keeps its number —
-- the sequence must audit clean, so numbers burn.
create sequence if not exists public.invoice_number_seq start 1;

create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  number      integer not null unique default nextval('public.invoice_number_seq'),
  buyer_id    uuid not null references public.buyers (id),
  -- shipped = sent to the buyer, complete = settled, voided = number burned
  -- and the lots returned to stock.
  status      text not null default 'shipped'
              check (status in ('shipped', 'complete', 'voided')),
  -- Sum of rate * quantity across the invoice's lots, frozen at create time so
  -- the list renders without joining lots (and survives a later void).
  projected   numeric(10,2) not null default 0,
  -- What it cost us to ship the devices to the buyer. Spread per unit into lot
  -- P/L at settle.
  shipping    numeric(10,2) not null default 0,
  paid        numeric(10,2),
  paid_method text,
  paid_at     timestamptz,
  note        text,
  voided_at   timestamptz,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists invoices_status_idx on public.invoices (status);
create index if not exists invoices_buyer_idx  on public.invoices (buyer_id);

-- =============================================================================
-- 10. Inventory — ONE ROW PER DEVICE.
-- =============================================================================
-- A lot IS one device. `quantity` stays as a column (always 1) so the money
-- math — per-unit shares, penny remainders on the last lot — ports unchanged
-- from the box-based predecessor. `cog` is PER UNIT; `sold_total` and
-- `ship_total` are lot totals written at settle. Lot P/L is therefore
-- sold_total - ship_total - cog * quantity, computed in the domain layer and
-- NEVER stored where it can drift.
--
-- Lifecycle: in_stock -> shipped (on invoice) -> complete (sold) | disposed.
-- Facts are editable (with the `edits` audit log) only while in_stock —
-- invoiced devices are part of a money document and lock. Transitions are
-- guarded compare-and-swaps in the repository, so concurrent operators lose
-- in the database.
create table if not exists public.inventory_lots (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id),
  item          text not null,
  category      text,
  quantity      integer not null check (quantity > 0),

  -- Device identity. IMEI for phones/cellular devices, serial for the rest
  -- (MacBooks). Both nullable — some devices have neither recorded — but an
  -- IMEI that IS recorded must be unique: buying the same phone twice is
  -- either a data error or a problem worth hearing about loudly.
  imei          text,
  serial        text,
  -- Unlocked / AT&T / T-Mobile / Verizon / Other. Free text on purpose.
  carrier       text,
  -- Cosmetic/functional grade. NO check constraint: the value list lives in
  -- app_settings under `grades` and is admin-editable, so the database must
  -- not enshrine a list the app can change.
  grade         text,
  -- Sickw-pulled facts (model_desc, color, storage, sim_lock, fmi, blacklist,
  -- battery, raw). A bag, not columns: the lookup service's shape is not ours
  -- to freeze, and nothing queries these fields relationally.
  details       jsonb not null default '{}'::jsonb,

  cog           numeric(10,2) not null default 0,
  -- Physical address of the device: tote/shelf, free text by design ("2",
  -- "2C"). Null means nobody recorded where it went — a blank is something
  -- the grid can list and someone can fix; a defaulted lie is not.
  location      text,
  status        text not null default 'in_stock'
                check (status in ('in_stock', 'shipped', 'complete', 'disposed')),
  invoice_id    uuid references public.invoices (id) on delete set null,
  -- Per-unit asking price on the invoice line.
  rate          numeric(10,2),
  sold_total    numeric(10,2),
  ship_total    numeric(10,2),
  -- The device arrived in this order's handover but no order line predicted it.
  not_on_order  boolean not null default false,
  disposed_at   timestamptz,
  dispose_note  text,
  -- Append-only log of in-stock edits: { at, by, field, from, to }. Lots lock
  -- once invoiced, so this only ever records pre-sale corrections.
  edits         jsonb not null default '[]'::jsonb,
  checked_in_by text,
  created_at    timestamptz not null default now()
);

comment on column public.inventory_lots.grade is
  'Cosmetic/functional grade. Values come from app_settings.grades (admin-'
  'editable), so deliberately no check constraint here.';
comment on column public.inventory_lots.location is
  'Physical address of the device: tote number, optionally plus a bag letter - '
  '"2" or "2C". Free text by design. Null means nobody recorded where it went.';

create unique index if not exists inventory_lots_imei_key
  on public.inventory_lots (imei)
  where imei is not null;
create index if not exists inventory_lots_status_idx  on public.inventory_lots (status);
create index if not exists inventory_lots_order_idx   on public.inventory_lots (order_id);
create index if not exists inventory_lots_invoice_idx on public.inventory_lots (invoice_id);
create index if not exists inventory_lots_created_idx on public.inventory_lots (created_at desc);
-- The pick list and "what is in tote 2" only ever ask about stock that is
-- still ours or on its way out. Partial, so the index stays small as
-- completed lots pile up.
create index if not exists inventory_lots_location_idx
  on public.inventory_lots (location)
  where status in ('in_stock', 'shipped');

-- =============================================================================
-- 11. Item catalog — DB-backed so the admin adds items without a deploy.
-- =============================================================================
-- A priceless item list on purpose: pricing is negotiated per person/buyer,
-- so reference prices do not exist here. `sort` preserves display ordering
-- within categories. Seeded from seed.sql, not here.
create table if not exists public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  category    text not null,
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- 12. Expenses — the admin-only business ledger.
-- =============================================================================
-- One flat ledger: the day the money left, a category, who it went to, and the
-- amount. Deliberately NOT a second place to store order or invoice money:
-- customer payouts live on orders, buyer shipping on invoices.
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  -- A plain date, not a timestamp: expenses are entered from receipts and
  -- statements, which say "Jul 12", not an instant.
  spent_on    date not null,
  category    text not null,
  vendor      text,
  note        text,
  amount      numeric(10,2) not null check (amount >= 0),
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists expenses_spent_on_idx on public.expenses (spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category);

-- =============================================================================
-- 13. Balance snapshots — the anchor the running balance rolls forward from.
-- =============================================================================
-- TWO POOLS, ONE NUMBER. Customers get paid in cash and electronically, so the
-- money lives in a bank account and in a drawer. Both are recorded, and the
-- app adds them: moving cash between them is an internal transfer that nets to
-- zero. They are stored separately anyway because "how much is in the drawer"
-- is a real question on its own. The gap between what the app EXPECTED and
-- what is actually there is the point of this table, not a defect in it.
create table if not exists public.balance_snapshots (
  id          uuid primary key default gen_random_uuid(),
  -- A day, not an instant: copied off a bank statement and a counted drawer,
  -- the same reason expenses.spent_on is a date.
  as_of       date not null,
  bank        numeric(12,2) not null default 0,
  cash        numeric(12,2) not null default 0,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- One per day, so re-entering today's figures CORRECTS the day rather than
-- stacking a second anchor the balance would have to choose between.
create unique index if not exists balance_snapshots_as_of_key
  on public.balance_snapshots (as_of);

-- =============================================================================
-- 14. App settings — the knobs an admin turns from /settings.
-- =============================================================================
-- jsonb value, not columns-per-setting: each future knob is an INSERT, not a
-- migration. Tenants: booking_hours (per-weekday windows + date overrides),
-- grades (the inventory grade list), payment_methods. Readers must treat a
-- missing row as "use the built-in default".
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.app_settings is
  'Admin-tunable app configuration, one row per key. Readers must treat a '
  'missing row as "use the built-in default".';
comment on column public.app_settings.value is
  'The setting, shaped per key. booking_hours: {"week":{"mon":{"start":"HH:MM",'
  '"end":"HH:MM"},...},"dates":{}}. grades / payment_methods: array of strings.';

-- =============================================================================
-- 15. Row-level security.
-- =============================================================================
alter table public.profiles          enable row level security;
alter table public.orders            enable row level security;
alter table public.messages          enable row level security;
alter table public.manual_customers  enable row level security;
alter table public.contact_notes     enable row level security;
alter table public.calls             enable row level security;
alter table public.buyers            enable row level security;
alter table public.invoices          enable row level security;
alter table public.inventory_lots    enable row level security;
alter table public.catalog_items     enable row level security;
alter table public.expenses          enable row level security;
alter table public.balance_snapshots enable row level security;
alter table public.app_settings      enable row level security;

-- Operational tables: full access for active, role-holding staff; nothing for
-- anon or a 'pending' signup. WHICH roles see which screens is enforced in
-- middleware via ROUTE_ACCESS (fail-closed), not duplicated here.
do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'messages', 'manual_customers', 'contact_notes',
    'calls', 'inventory_lots', 'invoices', 'buyers', 'catalog_items'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_staff()) with check (public.is_staff());',
      t || '_staff_all', t
    );
  end loop;
end $$;

-- Profiles: staff read the roster; a user may update their own row (the
-- protect_profile_role trigger blocks the security-relevant columns).
create policy profiles_read_all on public.profiles
  for select to authenticated using (public.is_staff());
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Money tables: admin-only IN THE DATABASE. The app asserts this in middleware
-- and again in the server actions; this is the third place, and the only one
-- an attacker with the anon key and a JWT cannot route around. Service role
-- bypasses RLS, so QA scripts and jobs keep working.
create policy expenses_admin_all on public.expenses
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy balance_snapshots_admin_all on public.balance_snapshots
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- app_settings: any signed-in staffer's client may READ (the booking grid and
-- the pickers render from these), and there is deliberately NO insert/update/
-- delete policy: /settings is admin-only in ROUTE_ACCESS, the save action
-- checks the role again, and the write goes through the service key.
create policy app_settings_staff_read on public.app_settings
  for select to authenticated using (true);

-- =============================================================================
-- 16. Realtime.
-- =============================================================================
-- The inbox bell and the live call log subscribe to inserts/updates. Realtime
-- honours RLS, and the browser socket authenticates SEPARATELY from REST — if
-- events stop arriving, check that realtime.setAuth() is being handed the
-- session token (see components/employee/InboundAlerts.jsx).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;

-- =============================================================================
-- 17. Table grants — the layer RLS composes WITH, not a substitute for it.
-- =============================================================================
-- Supabase enforces access as GRANTS ∧ POLICIES: a policy without the
-- underlying grant is "permission denied" for everyone, service key included
-- (how this section came to exist — the first cut shipped policies only and
-- the seed scripts hit exactly that wall). So: the two app roles get DML and
-- the policies above decide row by row; anon gets nothing at all — there is
-- no anonymous surface in this app.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- app_settings writes stay service-role-only (see its policy note above):
-- take the grant back from authenticated so the RLS gap is a closed door,
-- not an unused one.
revoke insert, update, delete on public.app_settings from authenticated;
