import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/checkin/validate
 * Body: { token: string } — token can be a full unique_token (QR scan)
 * or a 6-char short_code (manual fallback entry). Same code path either way.
 *
 * Check-in is recorded as an INSERT (never a check-then-update) into the
 * `checkin` table, relying on the UNIQUE constraint on guest_id to make
 * concurrent scans from multiple devices race-safe: the second INSERT for
 * the same guest fails with a unique-violation, which we translate into an
 * "already checked in" response instead of a hard error.
 */
export async function POST(req: NextRequest) {
  let token: string | undefined;
  try {
    const body = await req.json();
    token = typeof body?.token === 'string' ? body.token.trim() : undefined;
  } catch {
    // fall through to validation below
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_request', message: 'Token/kode tidak dikirim' },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // unique_token is a long opaque string; short_code is exactly 6 chars.
  // Look up on whichever column matches.
  const column = token.length === 6 ? 'short_code' : 'unique_token';

  const { data: guest, error: guestError } = await supabase
    .from('guest_list')
    .select('id, name, envelope_number')
    .eq(column, token)
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

  if (!rsvp || rsvp.status !== 'hadir') {
    return NextResponse.json(
      {
        ok: false,
        reason: 'not_attending',
        message: 'Status kehadiran tidak valid',
        hint: 'redirect_to_manual_add',
      },
      { status: 409 }
    );
  }

  // Try the atomic insert first — this is the race-safe path.
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
    guestCount: rsvp.guest_count,
    envelopeNumber: guest.envelope_number,
  });
}
