/**
 * Which side invited a guest. Dependency-free so both server routes and
 * client components can import it.
 */
export type InvitedBy = 'groom' | 'bride';

export const INVITED_BY_LABEL: Record<InvitedBy, string> = {
  groom: 'Reinaldo',
  bride: 'Eunike',
};

/** Accepts 'groom'/'bride' or anything a spreadsheet might say for each side. */
export function parseInvitedBy(raw: unknown): InvitedBy | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'groom' || s === 'pria' || s === 'rei' || s.startsWith('reinaldo') || s.includes('pihak pria')) return 'groom';
  if (s === 'bride' || s === 'wanita' || s === 'nike' || s.startsWith('eunike') || s.includes('pihak wanita')) return 'bride';
  return null;
}
