-- Who did the buy, per order and per device — the axis "profit per person"
-- rolls up on. Captured AUTOMATICALLY from the signed-in account at the buy
-- moment (Mark bought, or walk-in creation), never typed: a typed name would
-- fragment ("Jaime"/"jaime") and the login is already known.
--
-- On BOTH tables on purpose. The buy happens on the order; the lot copies it
-- at check-in because every P/L question is asked of lots, and a join back to
-- orders for one display name on every money rollup is the kind of read that
-- grows quietly.
--
-- inventory_lots.location is NOT dropped here even though the tote UI was
-- removed the same day — recorded addresses on existing stock stay readable
-- in the database, same reasoning as orders.type and quantity-always-1.

alter table public.orders add column if not exists bought_by text;
alter table public.inventory_lots add column if not exists bought_by text;

comment on column public.orders.bought_by is
  'Display name of the staff account that recorded the buy (Mark bought / walk-in creation). Automatic, never typed.';
comment on column public.inventory_lots.bought_by is
  'Copied from the order at check-in so per-person P/L reads lots alone.';
