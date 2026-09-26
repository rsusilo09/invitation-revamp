import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import AdminNav from '@/components/admin/AdminNav';

/**
 * Everything under /admin except /admin/login lives in this route group and
 * is gated here. Owner-only pages (e.g. /admin/akun) check the role again
 * themselves, and every admin API route checks independently too.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');

  return (
    <>
      <AdminNav email={session.email} role={session.role} />
      {children}
    </>
  );
}
