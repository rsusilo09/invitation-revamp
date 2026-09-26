import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase';
import { getAdminSession } from '@/lib/adminAuth';
import { loadAdminData, type AdminData } from '@/lib/adminData';
import AdminDashboard from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

/**
 * Admin dashboard. Owners: stats, guest list, blast, wishes, import.
 * Helpers: a read-only guest list only (wishes are never sent to them).
 * Auth is enforced by ../(panel)/layout.tsx and by every admin API route.
 */
export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');

  let initial: AdminData = { guests: [], wishes: [] };
  let loadError: string | null = null;
  try {
    const data = await loadAdminData(createServerSupabaseClient());
    initial = { guests: data.guests, wishes: session.role === 'owner' ? data.wishes : [] };
  } catch (e) {
    loadError = (e as Error).message;
  }
  return <AdminDashboard initial={initial} loadError={loadError} role={session.role} />;
}
