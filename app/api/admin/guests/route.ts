import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';
import { nextEnvelopeNumber, normalizeWaNumber } from '@/lib/adminData';
import { parseInvitedBy } from '@/lib/invitedBy';
import { generateShortCode, generateToken } from '@/lib/guestCodes';

/**
 * POST  /api/admin/guests { name, waNumber?, invitedBy? } — add one invited
 *        guest (fresh token + short code, next envelope number below 900).
 * PATCH /api/admin/guests { id, name?, waNumber?, invitedBy? }
 *
 * Envelope numbers are assigned by the server only (import / add / walk-in)
 * and are deliberately NOT editable here, so two guests can't end up sharing one.
 */
export async function POST(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ ok: false, message: 'Nama wajib diisi' }, { status: 400 });

  const supabase = createServerSupabaseClient();
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const envelope = await nextEnvelopeNumber(supabase, false);
    const { data, error } = await supabase
      .from('guest_list')
      .insert({
        name,
        unique_token: generateToken(),
        short_code: generateShortCode(),
        envelope_number: envelope,
        wa_number: normalizeWaNumber(body?.waNumber),
        invited_by: parseInvitedBy(body?.invitedBy),
        is_walkin: false,
      })
      .select('id')
      .single();
    if (!error) return NextResponse.json({ ok: true, id: data.id, envelopeNumber: envelope });
    lastError = error.message;
    if (error.code !== '23505') break; // only retry on unique collisions
  }
  return NextResponse.json({ ok: false, message: lastError }, { status: 500 });
}

export async function PATCH(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (typeof body?.name === 'string' && body.name.trim()) update.name = body.name.trim();
  if ('waNumber' in (body ?? {})) update.wa_number = normalizeWaNumber(body.waNumber);
  if ('invitedBy' in (body ?? {})) update.invited_by = parseInvitedBy(body.invitedBy);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, message: 'Tidak ada perubahan' }, { status: 400 });
  }

  const { error } = await createServerSupabaseClient().from('guest_list').update(update).eq('id', id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
