/**
 * Mask a credential identifier (RFID tag, phone hash, etc.). Shows the last
 * 4 characters only, e.g. "•••• 1A2B".
 */
export function maskCredential(value: string | null | undefined): string {
  if (!value) return '—';
  const v = String(value);
  if (v.length <= 4) return '•••• ' + v;
  return '•••• ' + v.slice(-4);
}
