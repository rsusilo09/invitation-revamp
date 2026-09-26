import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';
import { loadAdminData } from '@/lib/adminData';

export const dynamic = 'force-dynamic';

/** Guest list (+ wishes for the couple only — helpers don't see the wishes). */
export async function GET() {
  const { session, denied } = await requireAdminApi('helper');
  if (denied) return denied;
  try {
    const data = await loadAdminData(createServerSupabaseClient());
    return NextResponse.json({
      ok: true,
      guests: data.guests,
      wishes: session.role === 'owner' ? data.wishes : [],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
