-- Which side invited the guest (for filtering the invitation blast), and when
-- their personal invitation was last sent from the admin "Blast undangan" tab.
-- Run in the Supabase SQL editor.
alter table guest_list
  add column if not exists invited_by text check (invited_by in ('groom', 'bride')),
  add column if not exists invitation_sent_at timestamptz;

create index if not exists guest_list_invited_by_idx on guest_list(invited_by);
