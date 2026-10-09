-- Backfill: leads submitted through the website wizard before
-- createDeviceInquiry started writing contact_notes.lead_source (see
-- lib/repositories/device-inquiries.js) have no row there, so they never show
-- up as a "Website form" source anywhere outside /leads itself — the Source &
-- payment panel and the messages-inbox badge both read lead_source, not
-- device_inquiries. One-time and idempotent: re-running it is a no-op because
-- the WHERE clause only ever fills an empty lead_source, same rule
-- setLeadSourceIfEmpty enforces going forward.
--
-- Key is the last 10 digits, same as domain/format.js#normPhone — the wizard
-- posts an unnormalized phone, unlike contact_notes.phone (already a
-- normalized primary key).
insert into public.contact_notes (phone, lead_source, updated_at)
select distinct on (key) key, 'Website form', now()
from (
  select right(regexp_replace(phone, '\D', '', 'g'), 10) as key, created_at
  from public.device_inquiries
  where phone is not null
) d
where length(key) = 10
order by key, created_at asc
on conflict (phone) do update
  set lead_source = excluded.lead_source,
      updated_at = excluded.updated_at
where public.contact_notes.lead_source is null;
