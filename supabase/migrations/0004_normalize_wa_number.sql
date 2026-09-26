-- Guard: guest_list.wa_number is always stored as 62xxxxxxxx (digits only),
-- even when a row is added or edited directly in the Supabase table editor.
--   08123…  → 628123…      +62 812… → 62812…      812… → 62812…
-- Run once in the Supabase SQL editor. The final UPDATE also fixes rows
-- that were already saved as 08….

create or replace function public.normalize_wa_number()
returns trigger
language plpgsql
as $$
declare
  s text;
begin
  if new.wa_number is null then
    return new;
  end if;
  s := regexp_replace(new.wa_number, '[^0-9]', '', 'g');
  if s = '' then
    new.wa_number := null;
    return new;
  end if;
  if left(s, 1) = '0' then
    s := '62' || substr(s, 2);
  elsif left(s, 1) = '8' then
    s := '62' || s;
  end if;
  new.wa_number := s;
  return new;
end;
$$;

drop trigger if exists guest_list_normalize_wa_number on public.guest_list;
create trigger guest_list_normalize_wa_number
  before insert or update of wa_number on public.guest_list
  for each row execute function public.normalize_wa_number();

-- Re-save existing numbers so the trigger normalises them.
update public.guest_list set wa_number = wa_number where wa_number is not null;
