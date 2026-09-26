import { NextRequest, NextResponse } from 'next/server';
import { forgetLiveCheck, requireAdminApi, roleOf } from '@/lib/adminAuth';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isAdminRole, toLoginEmail, type AdminAccount, type AdminRole } from '@/lib/adminRoles';

/**
 * Admin accounts.
 * GET / POST: owner + PIC. A PIC only sees PIC + helper accounts, and can
 * only create *helper* accounts.
 * PATCH / DELETE: owner only.
 * GET    → accounts that can enter /admin (owners + helpers)
 * POST   { login, password, role, name? } → create (username or email)
 * PATCH  { id, password } → reset password
 * DELETE { id } → delete the account (can't delete yourself)
 *
 * Roles are written to app_metadata.reunited_role, which only the
 * service-role key can set.
 */

const MIN_PASSWORD = 8;

export async function GET() {
  const { session, denied } = await requireAdminApi('pic');
  if (denied) return denied;

  const supabase = createServerSupabaseClient();
  const accounts: AdminAccount[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    for (const u of data.users) {
      const role = roleOf(u);
      if (!role || !u.email) continue;
      // A PIC only sees PIC + helper accounts — groom & bride stay hidden (filtered server-side).
      if (session.role !== 'owner' && role === 'owner') continue;
      accounts.push({
        id: u.id,
        email: u.email,
        name: (u.user_metadata?.name as string | undefined) ?? null,
        role,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < 200) break;
  }
  const order: Record<AdminRole, number> = { owner: 0, pic: 1, helper: 2 };
  accounts.sort((a, b) => order[a.role] - order[b.role] || a.email.localeCompare(b.email));
  return NextResponse.json({ ok: true, accounts, me: session.uid });
}

export async function POST(req: NextRequest) {
  const { session, denied } = await requireAdminApi('pic');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const login = typeof body?.login === 'string' ? body.login.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const role: AdminRole = isAdminRole(body?.role) ? body.role : 'helper';
  if (session.role !== 'owner' && role !== 'helper') {
    return NextResponse.json({ ok: false, message: 'PIC hanya bisa membuat akun Helper' }, { status: 403 });
  }
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;

  if (!login || !/^[a-z0-9._@+-]+$/i.test(login)) {
    return NextResponse.json(
      { ok: false, message: 'Username hanya boleh huruf, angka, titik, strip (contoh: meja1)' },
      { status: 400 }
    );
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, message: `Password minimal ${MIN_PASSWORD} karakter` }, { status: 400 });
  }

  const { data, error } = await createServerSupabaseClient().auth.admin.createUser({
    email: toLoginEmail(login),
    password,
    email_confirm: true, // no confirmation mail — these are private staff accounts
    app_metadata: { reunited_role: role },
    user_metadata: name ? { name } : {},
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message) ? 'Username/email itu sudah dipakai' : error.message;
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: data.user?.id });
}

export async function PATCH(req: NextRequest) {
  const { denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!id) return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, message: `Password minimal ${MIN_PASSWORD} karakter` }, { status: 400 });
  }

  const { error } = await createServerSupabaseClient().auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { session, denied } = await requireAdminApi('owner');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ ok: false, message: 'Invalid request' }, { status: 400 });
  if (id === session.uid) {
    return NextResponse.json({ ok: false, message: 'Tidak bisa menghapus akun sendiri' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data: target } = await supabase.auth.admin.getUserById(id);
  if (!target?.user || !roleOf(target.user)) {
    return NextResponse.json({ ok: false, message: 'Akun tidak ditemukan' }, { status: 404 });
  }

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  forgetLiveCheck(id);
  return NextResponse.json({ ok: true });
}
