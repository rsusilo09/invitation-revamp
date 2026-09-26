import CheckinScanner from '@/components/admin/CheckinScanner';

/**
 * QR check-in scanner (html5-qrcode) with manual short_code fallback.
 * Calls POST /api/checkin/validate. Multiple devices can run this
 * concurrently — the API's atomic insert makes that race-safe.
 */
export default function CheckinPage() {
  return (
    <main className="ad-main ad-narrow">
      <CheckinScanner />
    </main>
  );
}
