/**
 * Admin dashboard — protected by Supabase Auth (email/password).
 * TODO (next pass): auth gate, RSVP table, wishes moderation (toggle
 * is_hidden), guest list + envelope numbers, CSV/Excel import UI wired
 * to /api/guest-list/import.
 */
export default function AdminPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Admin Dashboard</h1>
      <p style={{ opacity: 0.6 }}>Not built yet — scaffold placeholder.</p>
    </main>
  );
}
