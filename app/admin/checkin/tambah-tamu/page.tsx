/**
 * Walk-in guest form — large, simple UI for non-technical family members
 * at the door. Auto-generates token + envelope number (from a separate
 * range, e.g. starting at 900) and sets checked_in = true immediately.
 * TODO (next pass): the actual form + server action.
 */
export default function TambahTamuPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Tambah Tamu (Walk-in)</h1>
      <p style={{ opacity: 0.6 }}>Not built yet — scaffold placeholder.</p>
    </main>
  );
}
