import WalkinForm from '@/components/admin/WalkinForm';

/**
 * Walk-in guest form — large, simple UI for non-technical family members
 * at the door. Auto-generates token + envelope number (from a separate
 * range starting at 900) and checks the guest in immediately.
 */
export default function TambahTamuPage() {
  return (
    <main className="ad-main ad-narrow">
      <WalkinForm />
    </main>
  );
}
