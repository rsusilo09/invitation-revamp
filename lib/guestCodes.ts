import { randomBytes, randomUUID } from 'crypto';

/**
 * 6-digit numeric code — the manual fallback typed at the door. Digits only so
 * phones open the number pad (inputMode="numeric") instead of a full keyboard.
 */
export function generateShortCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function generateToken(): string {
  return randomUUID();
}

/** Walk-in envelopes use their own range so they never clash with invited guests. */
export const WALKIN_ENVELOPE_START = 900;
