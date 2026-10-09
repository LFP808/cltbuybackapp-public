-- =============================================================================
-- 0004: the "mms" storage bucket.
--
-- lib/storage.js has always required a PUBLIC bucket named "mms": an outbound
-- photo is uploaded there so Twilio can fetch it, and an inbound MMS is
-- re-hosted there so the thread can show it without Twilio credentials in the
-- browser. Nothing ever created it. On a fresh project every upload failed
-- with "Bucket not found": a sent photo became "couldn't be attached", and a
-- received photo became an empty bubble, because the webhook logs the failure
-- and stores the message without media rather than answer 500 (Twilio would
-- retry and duplicate the text).
--
-- A migration rather than a dashboard click so `supabase start` has it too,
-- and so the project's setup is a file and not a memory. The cloud project
-- runs this by hand in the SQL editor (DEPLOYMENT.md).
--
-- Public on purpose: Twilio fetches outbound media anonymously and <img> tags
-- load the inbound ones. Uploads go through the service role
-- (lib/supabase/admin.js), which bypasses storage RLS, so no storage.objects
-- policies are needed and none are granted: the anon key can read, never write.
--
-- 5 MB is Twilio's MMS ceiling. Carriers cap lower and Twilio downscales, and
-- the composer resizes before upload, so the limit is a backstop, not a target.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mms',
  'mms',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
