import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';

/** PATCH /api/admin/wishes { id, isHidden } — hide/unhide a wish on the public wall. */
export async function PATCH(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id || typeof body?.isHidden !== 'boolean') {
    return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });
  }

  const { error } = await createServerSupabaseClient()
    .from('wishes')
    .update({ is_hidden: body.isHidden })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
