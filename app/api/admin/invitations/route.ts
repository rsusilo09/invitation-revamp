import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';

/**
 * POST /api/admin/invitations { id, sent?: boolean }
 * Records that a guest's invitation was sent from the blast queue (the admin
 * clicked "Kirim", which opened WhatsApp with the message pre-filled).
 * `sent: false` clears it again ("tandai belum dikirim").
 */
export async function POST(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });

  const sentAt = body?.sent === false ? null : new Date().toISOString();
  const { error } = await createServerSupabaseClient()
    .from('guest_list')
    .update({ invitation_sent_at: sentAt })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sentAt });
}
