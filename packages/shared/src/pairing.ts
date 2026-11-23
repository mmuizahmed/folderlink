// Pairing codes are 8 characters from an alphabet that avoids look-alike glyphs.
// The displayed form inserts a hyphen. Comparisons use the normalized form.

export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;

export function normalizePairingCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  if (compact.length !== PAIRING_CODE_LENGTH) {
    return null;
  }
  for (const char of compact) {
    if (!PAIRING_ALPHABET.includes(char)) {
      return null;
    }
  }
  return compact;
}

export function formatPairingCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}
