-- Reunited wedding invitation — initial schema
-- Run via `supabase db push` or the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists guest_list (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unique_token text unique not null,
  short_code varchar(6) unique not null,
  envelope_number integer,
  is_walkin boolean default false,
  wa_number text,
  created_at timestamptz default now()
);

create table if not exists rsvp (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guest_list(id) not null,
  status text check (status in ('tidak_hadir', 'hadir')),
  guest_count integer,
  updated_at timestamptz default now()
);

create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guest_list(id) not null,
  message text not null,
  is_hidden boolean default false,
  created_at timestamptz default now()
);

create table if not exists checkin (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references guest_list(id) unique not null,
  checked_in boolean default false,
  checkin_time timestamptz
);

-- One RSVP row per guest (state machine in the app treats this as upsert-by-guest_id)
create unique index if not exists rsvp_guest_id_unique on rsvp(guest_id);

create index if not exists wishes_guest_id_idx on wishes(guest_id);
create index if not exists wishes_created_at_idx on wishes(created_at desc);
create index if not exists guest_list_short_code_idx on guest_list(short_code);
create index if not exists guest_list_unique_token_idx on guest_list(unique_token);

-- RLS: lock everything down by default. The app talks to Supabase using the
-- service-role key from server-side route handlers only, so no public
-- policies are defined here. Add narrowly-scoped policies if you later want
-- the browser to read directly via the anon key (e.g. public wishes wall).
alter table guest_list enable row level security;
alter table rsvp enable row level security;
alter table wishes enable row level security;
alter table checkin enable row level security;
