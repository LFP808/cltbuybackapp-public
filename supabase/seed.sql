-- =============================================================================
-- CLT Buyback — local/dev seed data.
--
-- Everything here is idempotent (on conflict / not-exists guards) so a re-run
-- corrects rather than duplicates. Production gets the same catalog and
-- settings; the demo buyer is convenience so the invoice builder works on a
-- fresh database without a setup step.
-- =============================================================================

-- --- Item catalog -------------------------------------------------------------
-- Pulled from the buyer price sheet (2026-08-13): base models only — storage,
-- carrier and lock status are per-device facts, not catalog variants. The
-- admin adds strays in-app at /pricing ("Item Catalog"). `sort` orders items
-- within a category; names are what the picker and the invoice lines show.
-- Generated together with src/domain/catalog.js — keep the two in step.
insert into public.catalog_items (name, category, sort) values
  ('iPhone 18 Pro Max', 'iPhone', 1),
  ('iPhone 18 Pro', 'iPhone', 2),
  ('iPhone 18', 'iPhone', 3),
  ('iPhone 17 Pro Max', 'iPhone', 10),
  ('iPhone 17 Pro', 'iPhone', 20),
  ('iPhone 17 Air', 'iPhone', 30),
  ('iPhone 17', 'iPhone', 40),
  ('iPhone 17E', 'iPhone', 50),
  ('iPhone 16 Pro Max', 'iPhone', 60),
  ('iPhone 16 Pro', 'iPhone', 70),
  ('iPhone 16 Plus', 'iPhone', 80),
  ('iPhone 16', 'iPhone', 90),
  ('iPhone 16E', 'iPhone', 100),
  ('iPhone 15 Pro Max', 'iPhone', 110),
  ('iPhone 15 Pro', 'iPhone', 120),
  ('iPhone 15 Plus', 'iPhone', 130),
  ('iPhone 15', 'iPhone', 140),
  ('iPhone 14 Pro Max', 'iPhone', 150),
  ('iPhone 14 Pro', 'iPhone', 160),
  ('iPhone 14 Plus', 'iPhone', 170),
  ('iPhone 14', 'iPhone', 180),
  ('iPhone 13 Pro Max', 'iPhone', 190),
  ('iPhone 13 Pro', 'iPhone', 200),
  ('iPhone 13', 'iPhone', 210),
  ('iPhone 13 Mini', 'iPhone', 220),
  ('iPhone SE (3rd Gen)', 'iPhone', 230),
  ('iPhone 12 Pro Max', 'iPhone', 240),
  ('iPhone 12 Pro', 'iPhone', 250),
  ('iPhone 12', 'iPhone', 260),
  ('iPhone 12 Mini', 'iPhone', 270),
  ('iPhone 11 Pro Max', 'iPhone', 280),
  ('iPhone 11 Pro', 'iPhone', 290),
  ('iPhone 11', 'iPhone', 300),
  ('iPhone SE (2020)', 'iPhone', 310),
  ('iPhone XS Max', 'iPhone', 320),
  ('iPhone XS', 'iPhone', 330),
  ('iPhone XR', 'iPhone', 340),
  ('iPhone X', 'iPhone', 350),
  ('iPhone 8 Plus', 'iPhone', 360),
  ('iPhone 8', 'iPhone', 370),
  ('iPhone 7 Plus', 'iPhone', 380),
  ('iPhone 7', 'iPhone', 390),
  ('Galaxy S26 Ultra', 'Samsung', 400),
  ('Galaxy S26 Plus', 'Samsung', 410),
  ('Galaxy S26', 'Samsung', 420),
  ('Galaxy Z Fold 7', 'Samsung', 430),
  ('Galaxy Z Flip 7', 'Samsung', 440),
  ('Galaxy S25 Ultra', 'Samsung', 450),
  ('Galaxy S25 Edge', 'Samsung', 460),
  ('Galaxy S25 Plus', 'Samsung', 470),
  ('Galaxy S25', 'Samsung', 480),
  ('Galaxy S25 FE', 'Samsung', 490),
  ('Galaxy Z Fold 6', 'Samsung', 500),
  ('Galaxy Z Flip 6', 'Samsung', 510),
  ('Galaxy S24 Ultra', 'Samsung', 520),
  ('Galaxy S24 Plus', 'Samsung', 530),
  ('Galaxy S24', 'Samsung', 540),
  ('Galaxy Z Fold 5', 'Samsung', 550),
  ('Galaxy Z Flip 5', 'Samsung', 560),
  ('Galaxy S23 Ultra', 'Samsung', 570),
  ('Galaxy S23 Plus', 'Samsung', 580),
  ('Galaxy S23', 'Samsung', 590),
  ('Galaxy Z Fold 4', 'Samsung', 600),
  ('Galaxy Z Flip 4', 'Samsung', 610),
  ('Galaxy S22 Ultra', 'Samsung', 620),
  ('Galaxy S22+', 'Samsung', 630),
  ('Galaxy S22', 'Samsung', 640),
  ('Galaxy S21 Ultra', 'Samsung', 650),
  ('Galaxy S21+', 'Samsung', 660),
  ('Galaxy S21', 'Samsung', 670),
  ('Galaxy Note 20 Ultra', 'Samsung', 680),
  ('Galaxy Note 20', 'Samsung', 690),
  ('Galaxy S20 Ultra', 'Samsung', 700),
  ('Galaxy S20+', 'Samsung', 710),
  ('Galaxy S20', 'Samsung', 720),
  ('Galaxy Z Fold 3', 'Samsung', 730),
  ('Galaxy Z Flip 3', 'Samsung', 740),
  ('Galaxy Note 10+', 'Samsung', 750),
  ('Galaxy Note 10', 'Samsung', 760),
  ('Galaxy S10+', 'Samsung', 770),
  ('Galaxy S10', 'Samsung', 780),
  ('iPad Pro 13" (M5)', 'iPad', 790),
  ('iPad Pro 13" (M4)', 'iPad', 800),
  ('iPad Pro 12.9" (6th Gen)', 'iPad', 810),
  ('iPad Pro 12.9" (5th Gen)', 'iPad', 820),
  ('iPad Pro 12.9" (4th Gen)', 'iPad', 830),
  ('iPad Pro 12.9" (3rd Gen)', 'iPad', 840),
  ('iPad Pro 11" (M5)', 'iPad', 850),
  ('iPad Pro 11" (M4)', 'iPad', 860),
  ('iPad Pro 11" (4th Gen)', 'iPad', 870),
  ('iPad Pro 11" (3rd Gen)', 'iPad', 880),
  ('iPad Pro 11" (2nd Gen)', 'iPad', 890),
  ('iPad Pro 11" (1st Gen)', 'iPad', 900),
  ('iPad Air 13" (M4)', 'iPad', 910),
  ('iPad Air 13" (M3)', 'iPad', 920),
  ('iPad Air 13" (M2)', 'iPad', 930),
  ('iPad Air 11" (M4)', 'iPad', 940),
  ('iPad Air 11" (M3)', 'iPad', 950),
  ('iPad Air 11" (M2)', 'iPad', 960),
  ('iPad Air 5', 'iPad', 970),
  ('iPad Air 4', 'iPad', 980),
  ('iPad Air 3', 'iPad', 990),
  ('iPad 11 (A16)', 'iPad', 1000),
  ('iPad 10', 'iPad', 1010),
  ('iPad 9', 'iPad', 1020),
  ('iPad 8', 'iPad', 1030),
  ('iPad 7', 'iPad', 1040),
  ('iPad 6', 'iPad', 1050),
  ('iPad 5', 'iPad', 1060),
  ('iPad Mini 7 (A17 Pro)', 'iPad', 1070),
  ('iPad Mini 6', 'iPad', 1080),
  ('iPad Mini 5', 'iPad', 1090),
  ('Apple Watch Ultra 3 49mm', 'Apple Watch', 1100),
  ('Apple Watch Series 11 46mm', 'Apple Watch', 1110),
  ('Apple Watch Series 11 42mm', 'Apple Watch', 1120),
  ('Apple Watch SE (3rd Gen) 44mm', 'Apple Watch', 1130),
  ('Apple Watch SE (3rd Gen) 40mm', 'Apple Watch', 1140),
  ('Apple Watch Ultra 2 49mm', 'Apple Watch', 1150),
  ('Apple Watch Series 10 46mm', 'Apple Watch', 1160),
  ('Apple Watch Series 10 42mm', 'Apple Watch', 1170),
  ('Apple Watch Series 9 45mm', 'Apple Watch', 1180),
  ('Apple Watch Series 9 41mm', 'Apple Watch', 1190),
  ('Apple Watch Ultra 49mm', 'Apple Watch', 1200),
  ('Apple Watch Series 8 45mm', 'Apple Watch', 1210),
  ('Apple Watch Series 8 41mm', 'Apple Watch', 1220),
  ('Apple Watch SE (2nd Gen) 44mm', 'Apple Watch', 1230),
  ('Apple Watch SE (2nd Gen) 40mm', 'Apple Watch', 1240),
  ('Apple Watch Series 7 45mm', 'Apple Watch', 1250),
  ('Apple Watch Series 7 41mm', 'Apple Watch', 1260),
  ('Pixel 10 Pro Fold', 'Google Pixel', 1270),
  ('Pixel 10 Pro XL', 'Google Pixel', 1280),
  ('Pixel 10 Pro', 'Google Pixel', 1290),
  ('Pixel 10a', 'Google Pixel', 1300),
  ('Pixel 10', 'Google Pixel', 1310),
  ('Pixel 9 Pro Fold', 'Google Pixel', 1320),
  ('Pixel 9 Pro XL', 'Google Pixel', 1330),
  ('Pixel 9 Pro', 'Google Pixel', 1340),
  ('Pixel 9a', 'Google Pixel', 1350),
  ('Pixel 9', 'Google Pixel', 1360),
  ('Pixel Fold', 'Google Pixel', 1370),
  ('Pixel 8 Pro', 'Google Pixel', 1380),
  ('Pixel 8a', 'Google Pixel', 1390),
  ('Pixel 8', 'Google Pixel', 1400),
  ('MacBook Air 13"', 'MacBook', 1410),
  ('MacBook Air 15"', 'MacBook', 1420),
  ('MacBook Pro 14"', 'MacBook', 1430),
  ('MacBook Pro 16"', 'MacBook', 1440),
  ('AirPods Pro', 'Other', 1450),
  ('Other device', 'Other', 1460)
on conflict (name) do update
  set category = excluded.category, sort = excluded.sort, active = true;

-- --- App settings -------------------------------------------------------------
-- booking_hours: the per-weekday schedule shape normalizeBookingSchedule()
-- expects — one window per weekday (null would mean closed), plus date
-- overrides. Default: open 8:00 AM to 8:00 PM every day, no overrides —
-- matching the built-in DEFAULT_BOOKING_SCHEDULE so a missing row and this
-- row behave identically.
insert into public.app_settings (key, value) values
  ('booking_hours', '{
    "week": {
      "mon": {"start": "08:00", "end": "20:00"},
      "tue": {"start": "08:00", "end": "20:00"},
      "wed": {"start": "08:00", "end": "20:00"},
      "thu": {"start": "08:00", "end": "20:00"},
      "fri": {"start": "08:00", "end": "20:00"},
      "sat": {"start": "08:00", "end": "20:00"},
      "sun": {"start": "08:00", "end": "20:00"}
    },
    "dates": {}
  }'::jsonb),
  -- The inventory grade list (check-in form, lot edits, filters). Admin-edited
  -- on /settings; inventory_lots.grade deliberately has no check constraint so
  -- this list can change without a migration.
  ('grades', '["Sealed", "A", "B", "C", "Broken"]'::jsonb),
  -- Offered by the payout form and the invoice settle form.
  ('payment_methods', '["Cash", "Zelle", "Cash App", "Venmo", "Wire"]'::jsonb)
on conflict (key) do nothing;

-- --- Demo buyer ---------------------------------------------------------------
-- One buyer so the invoice builder has a dropdown entry on a fresh database.
-- No unique constraint on buyers.name, so guard by hand.
insert into public.buyers (name, terms, created_by)
select 'Local Wholesale', 'Payment due on receipt.', 'seed'
where not exists (select 1 from public.buyers where name = 'Local Wholesale');
