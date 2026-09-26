-- Optional but recommended: no two guests may share an envelope number.
-- Protects the walk-in form when two door devices add a guest at the same
-- moment (the API retries with the next number on a collision).
-- Run in the Supabase SQL editor. If it fails with "could not create unique
-- index", some guests already share a number — fix them in the admin
-- dashboard (duplicates are highlighted) and run it again.
create unique index if not exists guest_list_envelope_number_unique
  on guest_list(envelope_number)
  where envelope_number is not null;
