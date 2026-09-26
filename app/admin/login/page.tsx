import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import LoginForm from '@/components/admin/LoginForm';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/admin') ? next : '/admin';
  if (await getAdminSession()) redirect(safeNext);

  return (
    <main className="ad-main ad-narrow" style={{ paddingTop: '12vh', maxWidth: 420 }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div className="ad-eyebrow">Reinaldo &amp; Eunike · #REunited</div>
        <h1 className="ad-h1" style={{ marginTop: 8 }}>Admin</h1>
      </div>
      <LoginForm next={safeNext} />
    </main>
  );
}
