/**
 * QR check-in scanner (html5-qrcode) with manual short_code fallback.
 * Calls POST /api/checkin/validate. Multiple devices can run this
 * concurrently — the API's atomic insert makes that race-safe.
 * TODO (next pass): camera scanner UI + manual fallback form.
 */
export default function CheckinPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Check-in</h1>
      <p style={{ opacity: 0.6 }}>Not built yet — scaffold placeholder.</p>
    </main>
  );
}
