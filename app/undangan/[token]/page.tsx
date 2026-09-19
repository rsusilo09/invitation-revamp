import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { createServerSupabaseClient } from '@/lib/supabase';
import StoryboardStage from '@/components/storyboard/StoryboardStage';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServerSupabaseClient();

  const { data: guest } = await supabase
    .from('guest_list')
    .select('id, name, short_code')
    .eq('unique_token', token)
    .maybeSingle();

  if (!guest) notFound();

  const { data: rsvpRow } = await supabase
    .from('rsvp')
    .select('status, guest_count')
    .eq('guest_id', guest.id)
    .maybeSingle();

  const qrDataUrl = rsvpRow?.status === 'hadir' ? await QRCode.toDataURL(token, { margin: 1, width: 480 }) : null;

  const { data: wishRows } = await supabase
    .from('wishes')
    .select('id, message, created_at, guest_list(name)')
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  const wishes = (wishRows ?? []).map((w) => ({
    id: w.id,
    name: (w.guest_list as unknown as { name: string } | null)?.name ?? 'Guest',
    message: w.message,
    when: new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }));

  return (
    <StoryboardStage
      token={token}
      guestName={guest.name}
      initialRsvp={{
        status: (rsvpRow?.status as 'hadir' | 'tidak_hadir' | null) ?? null,
        guestCount: rsvpRow?.guest_count ?? null,
        qrDataUrl,
        shortCode: guest.short_code,
      }}
      initialWishes={wishes}
    />
  );
}
