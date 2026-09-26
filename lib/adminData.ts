import type { SupabaseClient } from '@supabase/supabase-js';
import { WALKIN_ENVELOPE_START } from '@/lib/guestCodes';
import type { InvitedBy } from '@/lib/invitedBy';
import { normalizeWaNumber } from '@/lib/phone';

export { normalizeWaNumber } from '@/lib/phone';

export type { InvitedBy } from '@/lib/invitedBy';

export type AdminGuest = {
  id: string;
  name: string;
  token: string;
  shortCode: string;
  envelopeNumber: number | null;
  isWalkin: boolean;
  waNumber: string | null;
  invitedBy: InvitedBy | null;
  invitationSentAt: string | null;
  createdAt: string;
  rsvpStatus: 'hadir' | 'tidak_hadir' | null;
  guestCount: number | null;
  rsvpUpdatedAt: string | null;
  checkedIn: boolean;
  checkinTime: string | null;
};

export type AdminWish = {
  id: string;
  guestName: string;
  message: string;
  isHidden: boolean;
  createdAt: string;
};

export type AdminData = { guests: AdminGuest[]; wishes: AdminWish[] };

/** Everything the dashboard needs, in one go (a wedding list is small). */
export async function loadAdminData(supabase: SupabaseClient): Promise<AdminData> {
  const [g, r, c, w] = await Promise.all([
    supabase
      .from('guest_list')
      .select('id, name, unique_token, short_code, envelope_number, is_walkin, wa_number, invited_by, invitation_sent_at, created_at')
      .order('created_at', { ascending: true })
      .limit(5000),
    supabase.from('rsvp').select('guest_id, status, guest_count, updated_at').limit(5000),
    supabase.from('checkin').select('guest_id, checked_in, checkin_time').limit(5000),
    supabase
      .from('wishes')
      .select('id, message, is_hidden, created_at, guest_list(name)')
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);

  const firstError = g.error || r.error || c.error || w.error;
  if (firstError) {
    if (/invited_by|invitation_sent_at/.test(firstError.message)) {
      throw new Error(
        'Kolom invited_by belum ada — jalankan supabase/migrations/0003_invited_by_and_blast.sql di Supabase SQL editor.'
      );
    }
    throw new Error(firstError.message);
  }

  const rsvpBy = new Map((r.data ?? []).map((x) => [x.guest_id as string, x]));
  const checkBy = new Map((c.data ?? []).map((x) => [x.guest_id as string, x]));

  const guests: AdminGuest[] = (g.data ?? []).map((row) => {
    const rs = rsvpBy.get(row.id);
    const ck = checkBy.get(row.id);
    return {
      id: row.id,
      name: row.name,
      token: row.unique_token,
      shortCode: row.short_code,
      envelopeNumber: row.envelope_number,
      isWalkin: !!row.is_walkin,
      // Normalised on read too: rows edited directly in Supabase may hold 08xx.
      waNumber: normalizeWaNumber(row.wa_number),
      invitedBy: (row.invited_by as InvitedBy | null) ?? null,
      invitationSentAt: row.invitation_sent_at ?? null,
      createdAt: row.created_at,
      rsvpStatus: (rs?.status as AdminGuest['rsvpStatus']) ?? null,
      guestCount: rs?.guest_count ?? null,
      rsvpUpdatedAt: rs?.updated_at ?? null,
      checkedIn: !!ck?.checked_in,
      checkinTime: ck?.checkin_time ?? null,
    };
  });

  const wishes: AdminWish[] = (w.data ?? []).map((row) => ({
    id: row.id,
    guestName: (row.guest_list as unknown as { name: string } | null)?.name ?? '—',
    message: row.message,
    isHidden: !!row.is_hidden,
    createdAt: row.created_at,
  }));

  return { guests, wishes };
}

/**
 * Next free envelope number. Invited guests count up from 1 (below the
 * walk-in range); walk-ins count up from WALKIN_ENVELOPE_START (900).
 */
export async function nextEnvelopeNumber(supabase: SupabaseClient, walkin: boolean): Promise<number> {
  let q = supabase
    .from('guest_list')
    .select('envelope_number')
    .not('envelope_number', 'is', null)
    .order('envelope_number', { ascending: false })
    .limit(1);
  q = walkin
    ? q.gte('envelope_number', WALKIN_ENVELOPE_START)
    : q.lt('envelope_number', WALKIN_ENVELOPE_START);
  const { data } = await q;
  const max = data?.[0]?.envelope_number as number | undefined;
  if (walkin) return max ? max + 1 : WALKIN_ENVELOPE_START;
  return max ? max + 1 : 1;
}
