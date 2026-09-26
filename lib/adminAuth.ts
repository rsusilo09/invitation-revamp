import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase';
import { hasRole, isAdminRole, ROLE_LABEL, type AdminRole } from '@/lib/adminRoles';

/**
 * Admin session — Supabase Auth checks the email/password once, at login
 * (/api/admin/login). After that we keep our own small HMAC-signed cookie
 * instead of Supabase's access/refresh tokens, because:
 *  - Server Components can't write cookies, so a gate in a layout could never
 *    persist a refreshed Supabase token (sessions would silently die after 1h);
 *  - it needs no anon key.
 * The signing secret is ADMIN_SESSION_SECRET if set, else the service-role
 * key (server-only, never shipped to the browser).
 *
 * Roles live in the Supabase user's app_metadata.reunited_role ('owner' |
 * 'pic' | 'helper') — app_metadata can only be written with the service-role key, so
 * a user can't promote themselves. Accounts without that field (e.g. the
 * first account made in the Supabase dashboard) are owners if they pass the
 * optional ADMIN_EMAILS allowlist.
 *
 * Every request re-checks that the account still exists with the same role
 * (cached ~60s), so deleting a helper in the Akun menu locks them out quickly
 * instead of after the cookie's 14 days.
 */

export const ADMIN_COOKIE = 'reunited_admin';
const MAX_AGE_S = 60 * 60 * 24 * 14; // 14 days — covers the whole event week

export type AdminSession = { email: string; role: AdminRole; uid: string };

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Missing ADMIN_SESSION_SECRET / SUPABASE_SERVICE_ROLE_KEY');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function isAllowedAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(email.toLowerCase());
}

/** The role a Supabase Auth user has in this app, or null if none. */
export function roleOf(user: Pick<User, 'email' | 'app_metadata'>): AdminRole | null {
  const meta = user.app_metadata?.reunited_role;
  if (isAdminRole(meta)) return meta;
  if (user.email && isAllowedAdminEmail(user.email)) return 'owner';
  return null;
}

export function createSessionValue(s: AdminSession): string {
  const payload = Buffer.from(
    JSON.stringify({ e: s.email, r: s.role, u: s.uid, x: Math.floor(Date.now() / 1000) + MAX_AGE_S })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionValue(value: string | undefined | null): AdminSession | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof d?.e !== 'string' || typeof d?.u !== 'string' || typeof d?.x !== 'number') return null;
    if (!isAdminRole(d.r)) return null;
    if (d.x < Math.floor(Date.now() / 1000)) return null;
    return { email: d.e, role: d.r, uid: d.u };
  } catch {
    return null;
  }
}

// uid → { role still valid?, checked at }
const liveCheck = new Map<string, { role: AdminRole | null; at: number }>();
const LIVE_TTL_MS = 60_000;

export function forgetLiveCheck(uid: string) {
  liveCheck.delete(uid);
}

async function stillValid(s: AdminSession): Promise<boolean> {
  const hit = liveCheck.get(s.uid);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.role === s.role;
  const { data, error } = await createServerSupabaseClient().auth.admin.getUserById(s.uid);
  if (error && !data?.user) {
    const status = (error as { status?: number }).status;
    if (status !== 404) {
      // Network hiccup ≠ revoked: keep the last known result, else deny.
      return hit?.role === s.role;
    }
  }
  const role = data.user ? roleOf(data.user) : null;
  liveCheck.set(s.uid, { role, at: Date.now() });
  return role === s.role;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_S,
};

/** For Server Components / layouts. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const s = verifySessionValue(store.get(ADMIN_COOKIE)?.value);
  if (!s) return null;
  return (await stillValid(s)) ? s : null;
}

/**
 * For Route Handlers. `minRole` 'owner' (default) = couple only;
 * 'pic' = PIC + couple; 'helper' = everyone. Returns { session } or { denied } (a 401/403
 * response to return as-is).
 */
export async function requireAdminApi(
  minRole: AdminRole = 'owner'
): Promise<{ session: AdminSession; denied?: undefined } | { session?: undefined; denied: NextResponse }> {
  const session = await getAdminSession();
  if (!session) {
    return {
      denied: NextResponse.json(
        { ok: false, reason: 'unauthorized', message: 'Silakan login sebagai admin' },
        { status: 401 }
      ),
    };
  }
  if (!hasRole(session.role, minRole)) {
    return {
      denied: NextResponse.json(
        {
          ok: false,
          reason: 'forbidden',
          message: minRole === 'owner' ? 'Menu ini hanya untuk groom & bride' : `Menu ini untuk ${ROLE_LABEL[minRole]} ke atas`,
        },
        { status: 403 }
      ),
    };
  }
  return { session };
}
