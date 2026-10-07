// Works in the browser and on the server (Web Crypto). Used to suggest a temporary
// password; the server still validates whatever the superadmin submits.

// No look-alike characters (0/O, 1/l/I) since the superadmin shares this by hand
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 12): string {
  // Rejection sampling avoids modulo bias
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      if (byte < limit && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}
