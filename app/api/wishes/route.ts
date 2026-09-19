import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * GET /api/wishes — public wishes wall: all non-hidden wishes, newest first.
 * POST /api/wishes { token, message } — always open, independent of RSVP
 * status; a guest may submit more than one wish.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('wishes')
    .select('id, message, created_at, guest_list(name)')
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, wishes: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const message = typeof body?.message === 'string' ? body.message.trim() : undefined;

  if (!token || !message) {
    return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: guest, error: guestError } = await supabase
    .from('guest_list')
    .select('id')
    .eq('unique_token', token)
    .maybeSingle();

  if (guestError || !guest) {
    return NextResponse.json({ ok: false, message: 'Tamu tidak ditemukan' }, { status: 404 });
  }

  const { error } = await supabase.from('wishes').insert({ guest_id: guest.id, message });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
