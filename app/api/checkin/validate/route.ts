import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { requireAdminApi } from '@/lib/adminAuth';

/**
 * POST /api/checkin/validate  (admin only)
 * Body: { token: string, force?: boolean, guestCount?: number }
 *
 * `token` can be a full unique_token (QR scan), a pasted invitation URL, or a
 * 6-char short_code (manual fallback entry, case-insensitive). Same path.
 *
 * Check-in is recorded as an INSERT (never a check-then-update) into the
 * `checkin` table, relying on the UNIQUE constraint on guest_id to make
 * concurrent scans from multiple devices race-safe: the second INSERT for
 * the same guest fails with a unique-violation, which we translate into an
 * "already checked in" response instead of a hard error.
 *
 * A registered guest who never RSVP'd "hadir" gets `reason: 'not_attending'`.
 * The door staff can then confirm them anyway: re-send with `force: true`
 * and the number of people actually present — the RSVP is set to 'hadir'
 * with that count, then the normal check-in insert runs.
 */
export async function POST(req: NextRequest) {
  const { denied } = await requireAdminApi('helper');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  let token = typeof body?.token === 'string' ? body.token.trim() : '';
  const force = body?.force === true;

  // Someone may scan / paste the invitation link itself instead of the QR.
  const fromUrl = token.match(/\/undangan\/([^/?#\s]+)/);
  if (fromUrl) token = decodeURIComponent(fromUrl[1]);

  if (!token) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_request', message: 'Token/kode tidak dikirim' },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // unique_token is a long opaque string; short_code is exactly 6 chars.
  const isShort = token.length === 6;
  const { data: guest, error: guestError } = await supabase
    .from('guest_list')
    .select('id, name, envelope_number, is_walkin')
    .eq(isShort ? 'short_code' : 'unique_token', isShort ? token.toUpperCase() : token)
    .maybeSingle();

  if (guestError) {
    return NextResponse.json(
      { ok: false, reason: 'server_error', message: guestError.message },
      { status: 500 }
    );
  }

  if (!guest) {
    return NextResponse.json(
      { ok: false, reason: 'not_found', message: 'Tamu tidak terdaftar' },
      { status: 404 }
    );
  }

  const { data: rsvp } = await supabase
    .from('rsvp')
    .select('status, guest_count')
    .eq('guest_id', guest.id)
    .maybeSingle();

  let guestCount: number | null = rsvp?.guest_count ?? null;

  if (!rsvp || rsvp.status !== 'hadir') {
    // Already checked in through some other path? Report that first.
    const { data: prior } = await supabase
      .from('checkin')
      .select('checkin_time')
      .eq('guest_id', guest.id)
      .maybeSingle();
    if (prior) {
      return NextResponse.json({
        ok: false,
        reason: 'already_checked_in',
        message: 'Sudah check-in sebelumnya',
        checkinTime: prior.checkin_time,
        guestName: guest.name,
        guestCount,
        envelopeNumber: guest.envelope_number,
      });
    }

    if (!force) {
      return NextResponse.json(
        {
          ok: false,
          reason: 'not_attending',
          message:
            rsvp?.status === 'tidak_hadir'
              ? 'RSVP tamu ini: tidak hadir'
              : 'Tamu ini belum mengisi RSVP',
          rsvpStatus: rsvp?.status ?? null,
          guestName: guest.name,
          envelopeNumber: guest.envelope_number,
          hint: 'confirm_with_force',
        },
        { status: 409 }
      );
    }

    guestCount = Math.min(10, Math.max(1, Math.trunc(Number(body?.guestCount)) || 1));
    const payload = { guest_id: guest.id, status: 'hadir', guest_count: guestCount, updated_at: new Date().toISOString() };
    const { error: rsvpError } = rsvp
      ? await supabase.from('rsvp').update(payload).eq('guest_id', guest.id)
      : await supabase.from('rsvp').insert(payload);
    if (rsvpError) {
      return NextResponse.json(
        { ok: false, reason: 'server_error', message: rsvpError.message },
        { status: 500 }
      );
    }
  }

  // The atomic insert — this is the race-safe path.
  const { error: insertError } = await supabase
    .from('checkin')
    .insert({ guest_id: guest.id, checked_in: true, checkin_time: new Date().toISOString() });

  if (insertError) {
    // 23505 = unique_violation → someone already checked this guest in
    // (possibly a concurrent scan from another device).
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('checkin')
        .select('checkin_time')
        .eq('guest_id', guest.id)
        .maybeSingle();

      return NextResponse.json({
        ok: false,
        reason: 'already_checked_in',
        message: 'Sudah check-in sebelumnya',
        checkinTime: existing?.checkin_time ?? null,
        guestName: guest.name,
        guestCount,
        envelopeNumber: guest.envelope_number,
      });
    }

    return NextResponse.json(
      { ok: false, reason: 'server_error', message: insertError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    reason: 'checked_in',
    message: `Selamat datang, ${guest.name}`,
    guestName: guest.name,
    guestCount,
    envelopeNumber: guest.envelope_number,
  });
}
