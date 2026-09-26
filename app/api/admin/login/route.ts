import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_COOKIE, createSessionValue, roleOf, sessionCookieOptions } from '@/lib/adminAuth';
import { toLoginEmail } from '@/lib/adminRoles';

/**
 * POST /api/admin/login { email, password }  — `email` may also be a helper
 * username ("meja1"). Verifies the credentials against Supabase Auth
 * (server-side, so no anon key is needed in the browser), works out the role
 * (lib/adminAuth.ts → roleOf), then issues our own signed session cookie.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const login = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!login || !password) {
    return NextResponse.json({ ok: false, message: 'Username/email dan password wajib diisi' }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, message: 'Konfigurasi Supabase belum lengkap' }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email: toLoginEmail(login), password });
  if (error || !data.user?.email) {
    return NextResponse.json({ ok: false, message: 'Username/email atau password salah' }, { status: 401 });
  }

  const role = roleOf(data.user);
  if (!role) {
    return NextResponse.json({ ok: false, message: 'Akun ini tidak punya akses admin' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(
    ADMIN_COOKIE,
    createSessionValue({ email: data.user.email, role, uid: data.user.id }),
    sessionCookieOptions
  );
  return res;
}
