import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';
import { nextEnvelopeNumber, normalizeWaNumber } from '@/lib/adminData';
import { generateShortCode, generateToken } from '@/lib/guestCodes';

/**
 * POST /api/admin/walkin { name, guestCount, waNumber? }
 * A guest who arrives without an invitation: creates the guest (is_walkin,
 * envelope number from the 900+ range), an RSVP 'hadir' with the head count
 * (capped at 2, same as the invitation RSVP),
 * and the check-in row — all in one go, so the door staff do one tap.
 */
export async function POST(req: NextRequest) {
  const { denied } = await requireAdminApi('helper');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const guestCount = Math.min(2, Math.max(1, Math.trunc(Number(body?.guestCount)) || 1));
  if (!name) return NextResponse.json({ ok: false, message: 'Nama wajib diisi' }, { status: 400 });

  const supabase = createServerSupabaseClient();

  let guest: { id: string; envelope_number: number; short_code: string } | null = null;
  let lastError = '';
  // Retry on unique collisions (short_code, or envelope_number when the
  // 0002 unique index is applied and two door devices race for the same number).
  for (let attempt = 0; attempt < 6 && !guest; attempt++) {
    const envelope = await nextEnvelopeNumber(supabase, true);
    const { data, error } = await supabase
      .from('guest_list')
      .insert({
        name,
        unique_token: generateToken(),
        short_code: generateShortCode(),
        envelope_number: envelope,
        wa_number: normalizeWaNumber(body?.waNumber),
        is_walkin: true,
      })
      .select('id, envelope_number, short_code')
      .single();
    if (!error) guest = data;
    else {
      lastError = error.message;
      if (error.code !== '23505') break;
    }
  }
  if (!guest) return NextResponse.json({ ok: false, message: lastError || 'Gagal menyimpan' }, { status: 500 });

  const now = new Date().toISOString();
  const { error: rsvpError } = await supabase
    .from('rsvp')
    .insert({ guest_id: guest.id, status: 'hadir', guest_count: guestCount, updated_at: now });
  const { error: checkinError } = await supabase
    .from('checkin')
    .insert({ guest_id: guest.id, checked_in: true, checkin_time: now });

  if (rsvpError || checkinError) {
    return NextResponse.json(
      {
        ok: false,
        message: `Tamu tersimpan (amplop ${guest.envelope_number}) tapi check-in gagal: ${(rsvpError || checkinError)!.message}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    name,
    guestCount,
    envelopeNumber: guest.envelope_number,
  });
}
