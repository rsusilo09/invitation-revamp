# Admin area

Routes (all under `app/admin/`):
- `/admin/login` — email/password, checked against Supabase Auth server-side
  (`/api/admin/login`). Create admin users in Supabase → Authentication → Users.
- `(panel)/layout.tsx` gates everything else with a signed cookie (`lib/adminAuth.ts`).
- `/admin` — dashboard (`AdminDashboard.tsx`): stats, guest list with RSVP /
  check-in / editable envelope numbers, copy link / WhatsApp / CSV export,
  wishes moderation (hide/unhide), CSV/Excel import + add single guest.
- `/admin/checkin` — QR scanner (`CheckinScanner.tsx`, html5-qrcode) + manual
  6-char code. Registered-but-not-attending guests can be confirmed anyway
  (`force: true`). Camera needs HTTPS or localhost.
- `/admin/checkin/tambah-tamu` — walk-in form (`WalkinForm.tsx`): envelope
  numbers from 900, RSVP hadir + checked in immediately.

Admin APIs (`app/api/admin/*`, plus `checkin/validate` and `guest-list/import`)
all call `requireAdminApi()`.

Env: optional `ADMIN_EMAILS` (comma-separated allowlist — recommended, the
Supabase project is shared) and optional `ADMIN_SESSION_SECRET` (defaults to
the service-role key). Optional migration `0002_envelope_unique.sql`.
