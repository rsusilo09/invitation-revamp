/**
 * Admin roles — dependency-free so client components can import it.
 *  - owner  : the couple (groom & bride) — everything.
 *  - pic    : person in charge on the day — everything a helper can do, plus
 *             creating *helper* accounts in Menu Akun. Can't delete accounts,
 *             reset passwords, or create PIC / owner accounts.
 *  - helper : door staff on the day — Daftar tamu (read-only), Scan check-in,
 *             Tamu walk-in. No blast, wishes, import, accounts.
 */
export type AdminRole = 'owner' | 'pic' | 'helper';

export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: 'Groom & bride',
  pic: 'PIC',
  helper: 'Helper',
};

const RANK: Record<AdminRole, number> = { helper: 1, pic: 2, owner: 3 };

/** true if `role` has at least the access of `min`. */
export function hasRole(role: AdminRole, min: AdminRole): boolean {
  return RANK[role] >= RANK[min];
}

export function isAdminRole(v: unknown): v is AdminRole {
  return v === 'owner' || v === 'pic' || v === 'helper';
}

/**
 * Helpers can log in with a plain username ("meja1"); it is stored in
 * Supabase Auth as a pseudo-email on the reserved `.test` TLD (never mailed).
 */
export const HELPER_EMAIL_DOMAIN = 'reunited.test';

export function toLoginEmail(input: string): string {
  const s = input.trim().toLowerCase();
  return s.includes('@') ? s : `${s}@${HELPER_EMAIL_DOMAIN}`;
}

/** Show "meja1" instead of "meja1@reunited.test". */
export function displayLogin(email: string): string {
  const suffix = `@${HELPER_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

export type AdminAccount = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  createdAt: string;
  lastSignInAt: string | null;
};
