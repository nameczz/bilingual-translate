/**
 * Encrypt and decrypt API keys using Web Crypto API.
 * Uses AES-GCM with a derived key from a device-specific salt.
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

/**
 * Get or create a persistent salt for key derivation.
 */
async function getSalt() {
  const result = await chrome.storage.local.get('_encryption_salt');
  if (result._encryption_salt) {
    return new Uint8Array(result._encryption_salt);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ _encryption_salt: Array.from(salt) });
  return salt;
}

/**
 * Derive an encryption key from the extension ID and salt.
 */
async function deriveKey(salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(chrome.runtime.id),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {Promise<string>} Base64-encoded ciphertext with IV prepended.
 */
export async function encrypt(plaintext) {
  const salt = await getSalt();
  const key = await deriveKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a Base64-encoded ciphertext.
 * @param {string} ciphertext
 * @returns {Promise<string>} Decrypted plaintext.
 */
export async function decrypt(ciphertext) {
  const salt = await getSalt();
  const key = await deriveKey(salt);
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}
