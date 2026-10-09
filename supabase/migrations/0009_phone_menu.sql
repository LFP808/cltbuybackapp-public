-- Auto-answered calls: the busy message and the phone menu.
--
-- An incoming call used to ring everyone the moment it arrived. Now, unless
-- /settings says to ring straight through, something answers it first:
--
--   "message" mode (the default)  nothing rings - the caller hears "All of
--       our employees are busy... text us", gets the missed-call text, and
--       the call ends.
--   "menu" mode  "This is CLT Buyback. To sell a device, press 1...", then
--       the phones ring.
--
-- Either way it is TwiML picking up the call, so Twilio closes every such
-- call as "completed" - including the caller who never spoke to anyone.
-- Without a record of what the auto-answer did, those callers are filed as
-- Answered and never reach the follow-up queue: the same
-- lead-lost-by-bookkeeping the voicemail greeting caused before to_voicemail
-- existed. Two facts fix it:
--
--   menu_at      WHEN the auto-answer picked up.
--
--   menu_choice  WHAT became of the call, as a key from
--                domain/phone-menu.js:
--                  'told_to_text'  got the busy message (message mode)
--                  'sell', 'appointment', 'info', 'other'  the menu key
--                  'none'  rang through on silence or a key not offered
--                NULL with menu_at set = hung up inside the menu.
--                Text, no check constraint: the menu is a table in code, and
--                adding an option must not need a migration.
--
-- Both nullable with no default, so every existing row - and every call
-- taken in "ring" mode - reads as "not auto-answered", which is the truth.
--
-- No setting row is inserted for the mode (app_settings `incoming_calls`): a
-- missing row means the default, the same "missing row = the built-in
-- default" rule every setting follows.

alter table public.calls add column if not exists menu_at     timestamptz;
alter table public.calls add column if not exists menu_choice text;

comment on column public.calls.menu_at is
  'When the auto-answer (busy message or phone menu) picked up this call. '
  'NULL = it rang straight through, is outbound, or predates the auto-answer.';
comment on column public.calls.menu_choice is
  'What the auto-answer did with the call: ''told_to_text'' (busy message), a '
  'menu key from domain/phone-menu.js, or ''none'' (rang through without a '
  'usable key). NULL with menu_at set = the caller hung up inside the menu.';
