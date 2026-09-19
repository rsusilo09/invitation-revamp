import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/rsvp?token=xxx
 * Returns the current state for the frame-13 RSVP panel: guest name,
 * rsvp status/guestCount (null if not submitted yet), the 6-char
 * short_code fallback, and — only once status is 'hadir' — a QR code
 * (data URL) encoding the guest's unique_token, generated server-side.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ ok: false, message: 'Missing token' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: guest, error: guestError } = await supabase
    .from('guest_list')
    .select('id, name, short_code')
    .eq('unique_token', token)
    .maybeSingle();

  if (guestError || !guest) {
    return NextResponse.json({ ok: false, message: 'Tamu tidak ditemukan' }, { status: 404 });
  }

  const { data: rsvp } = await supabase
    .from('rsvp')
    .select('status, guest_count')
    .eq('guest_id', guest.id)
    .maybeSingle();

  let qrDataUrl: string | null = null;
  if (rsvp?.status === 'hadir') {
    qrDataUrl = await QRCode.toDataURL(token, { margin: 1, width: 480 });
  }

  return NextResponse.json({
    ok: true,
    guestName: guest.name,
    shortCode: guest.short_code,
    status: rsvp?.status ?? null,
    guestCount: rsvp?.guest_count ?? null,
    qrDataUrl,
  });
}

/**
 * POST /api/rsvp
 * Body: { token: string, status: 'hadir' | 'tidak_hadir', guestCount?: number }
 *
 * Implements the frame-13 RSVP state machine server-side:
 *  - No existing row yet          → insert (either status allowed)
 *  - Existing status = 'hadir'    → LOCKED. Only guestCount may be updated;
 *                                    status can never move away from 'hadir'.
 *  - Existing status = 'tidak_hadir' → may transition to 'hadir' (with a
 *                                    guestCount), but never re-submit as
 *                                    'tidak_hadir' again once flipped.
 *
 * Wishes are handled separately by /api/wishes — intentionally independent
 * of RSVP status.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const status = body?.status;
  const guestCount = body?.guestCount;
  // Guests are capped at 1-2 per invitation (frame-13 rule, 2026-09-19).
  // Clamp server-side too so a raw API call can't bypass the UI's max={2}.
  const clampedGuestCount =
    status === 'hadir' ? Math.min(2, Math.max(1, Number(guestCount) || 1)) : null;

  if (!token || (status !== 'hadir' && status !== 'tidak_hadir')) {
    return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: guest, error: guestError } = await supabase
    .from('guest_list')
    .select('id, name')
    .eq('unique_token', token)
    .maybeSingle();

  if (guestError || !guest) {
    return NextResponse.json({ ok: false, message: 'Tamu tidak ditemukan' }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from('rsvp')
    .select('id, status')
    .eq('guest_id', guest.id)
    .maybeSingle();

  // Locked: once 'hadir', status can never change — only guest_count.
  if (existing?.status === 'hadir') {
    if (status !== 'hadir') {
      return NextResponse.json(
        { ok: false, message: 'Status sudah final sebagai hadir, tidak bisa diubah' },
        { status: 409 }
      );
    }
    const { error } = await supabase
      .from('rsvp')
      .update({ guest_count: clampedGuestCount, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  } else {
    // Either no row yet, or existing row is 'tidak_hadir' (may flip to 'hadir').
    const payload = {
      guest_id: guest.id,
      status,
      guest_count: clampedGuestCount,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await supabase.from('rsvp').update(payload).eq('id', existing.id)
      : await supabase.from('rsvp').insert(payload);
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
