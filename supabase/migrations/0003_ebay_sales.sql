-- Direct-channel sales (eBay): a device can sell WITHOUT an invoice.
--
-- The invoice stays the wholesale money document; a direct sale is the other
-- shape of revenue — one device, one marketplace payout, fees taken by the
-- platform. Modeled on the LOT, not a synthetic one-line invoice, because an
-- invoice to "eBay" would burn numbers and demand settle ceremony for what is
-- a single recorded fact: it sold, for this much, minus these fees.
--
-- A direct-sold lot is `status = complete` with `invoice_id` NULL and
-- `sold_channel` set — that pair is how every money screen tells the two
-- kinds of Sold apart.

alter table public.inventory_lots add column if not exists fee_total    numeric(10,2);
alter table public.inventory_lots add column if not exists sold_channel text;
alter table public.inventory_lots add column if not exists sold_at      timestamptz;

comment on column public.inventory_lots.fee_total is
  'Selling fees taken by the marketplace (final value + ad fees, one number). Null on wholesale invoice sales.';
comment on column public.inventory_lots.sold_channel is
  'Direct-sale channel ("eBay"). Null when the sale went through an invoice.';
comment on column public.inventory_lots.sold_at is
  'When a direct sale happened — the P/L recognition date. Invoice sales date by the invoice''s paid_at instead.';
