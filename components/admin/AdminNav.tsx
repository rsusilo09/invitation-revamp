'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { displayLogin, hasRole, ROLE_LABEL, type AdminRole } from '@/lib/adminRoles';

const LINKS: { href: string; owner: string; helper?: string; minRole?: AdminRole }[] = [
  { href: '/admin', owner: 'Dashboard', helper: 'Daftar tamu' },
  { href: '/admin/checkin', owner: 'Scan Check-in' },
  { href: '/admin/checkin/tambah-tamu', owner: 'Tamu Walk-in' },
  { href: '/admin/akun', owner: 'Akun', minRole: 'pic' },
];

export default function AdminNav({ email, role }: { email: string; role: AdminRole }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    router.replace('/admin/login');
    router.refresh();
  }

  return (
    <header className="ad-header">
      <div className="ad-header-in">
        <div className="ad-brand">
          R <span>&amp;</span> E
        </div>
        <nav className="ad-nav">
          {LINKS.filter((l) => !l.minRole || hasRole(role, l.minRole)).map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined}>
              {role !== 'owner' && l.helper ? l.helper : l.owner}
            </Link>
          ))}
        </nav>
        <span className="ad-small ad-muted ad-hide-sm">
          {displayLogin(email)} · {ROLE_LABEL[role]}
        </span>
        <button className="ad-btn ad-btn-ghost ad-btn-sm" onClick={logout}>
          Keluar
        </button>
      </div>
    </header>
  );
}
