/**
 * Indonesian WhatsApp numbers: 08xx / +62 / 62 / 8xx → 62xx digits only.
 * Dependency-free so client components can use it too.
 */
export function normalizeWaNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '62' + s.slice(1);
  else if (s.startsWith('8')) s = '62' + s;
  return s.length >= 9 ? s : null;
}
