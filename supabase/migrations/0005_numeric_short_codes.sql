-- Check-in fallback codes become 6 digits (was 6 hex chars) so the door
-- staff's phone shows the number pad. New guests already get numeric codes
-- from the app; this converts every existing non-numeric code.
-- Guests only see this code under their QR in the invitation (it is not part
-- of the invitation link), so changing it is safe. Run once in the Supabase
-- SQL editor.
do $$
declare
  g record;
  candidate text;
begin
  for g in select id from public.guest_list where short_code !~ '^[0-9]{6}$' loop
    loop
      candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
      begin
        update public.guest_list set short_code = candidate where id = g.id;
        exit;
      exception when unique_violation then
        -- collided with an existing code; try another number
      end;
    end loop;
  end loop;
end $$;
