import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import AccountsManager from '@/components/admin/AccountsManager';

/** Admin accounts. Groom & bride: full control. PIC: view + create helpers. */
export default async function AkunPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  if (session.role === 'helper') redirect('/admin');

  return (
    <main className="ad-main" style={{ maxWidth: 820 }}>
      <AccountsManager role={session.role} />
    </main>
  );
}
