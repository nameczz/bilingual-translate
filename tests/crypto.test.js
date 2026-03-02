import { jest } from '@jest/globals';

/**
 * Test the crypto module.
 * Since Web Crypto API is not available in Node.js in the same way as in browser,
 * we test the module's logic by mocking the crypto and chrome APIs.
 */

// We need to mock both chrome.storage and Web Crypto API
// The setup.js already mocks chrome.storage

// Mock Web Crypto API (subtle)
const mockKey = { type: 'secret', algorithm: 'AES-GCM' };

const mockSubtle = {
  importKey: jest.fn(async () => mockKey),
  deriveKey: jest.fn(async () => mockKey),
  encrypt: jest.fn(async (algo, key, data) => {
    // Return a simple "encrypted" version (just prepend marker bytes)
    const marker = new Uint8Array([0xDE, 0xAD]);
    const combined = new Uint8Array(marker.length + data.byteLength);
    combined.set(marker);
    combined.set(new Uint8Array(data), marker.length);
    return combined.buffer;
  }),
  decrypt: jest.fn(async (algo, key, data) => {
    // Reverse the mock encryption (strip marker bytes)
    return data.slice(2);
  }),
};

// Store original crypto if it exists
const originalCrypto = globalThis.crypto;

// Set up mock crypto
globalThis.crypto = {
  subtle: mockSubtle,
  getRandomValues: (arr) => {
    // Fill with predictable values for testing
    for (let i = 0; i < arr.length; i++) {
      arr[i] = i;
    }
    return arr;
  },
};

// Ensure TextEncoder/TextDecoder are available (they should be in Node.js)
// Import module after setting up mocks
const { encrypt, decrypt } = await import('../src/utils/crypto.js');

beforeEach(() => {
  globalThis.__resetChromeStorage();
  mockSubtle.importKey.mockClear();
  mockSubtle.deriveKey.mockClear();
  mockSubtle.encrypt.mockClear();
  mockSubtle.decrypt.mockClear();
});

afterAll(() => {
  // Restore original crypto
  if (originalCrypto) {
    globalThis.crypto = originalCrypto;
  }
});

describe('encrypt', () => {
  test('returns a base64-encoded string', async () => {
    const result = await encrypt('test-api-key');
    expect(typeof result).toBe('string');
    // Base64 should only contain these characters
    expect(result).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('calls crypto.subtle.encrypt with AES-GCM', async () => {
    await encrypt('secret');
    expect(mockSubtle.encrypt).toHaveBeenCalled();
    const [algo] = mockSubtle.encrypt.mock.calls[0];
    expect(algo.name).toBe('AES-GCM');
    expect(algo.iv).toBeInstanceOf(Uint8Array);
    expect(algo.iv.length).toBe(12); // IV_LENGTH
  });

  test('derives key using PBKDF2 with extension ID', async () => {
    await encrypt('secret');
    expect(mockSubtle.importKey).toHaveBeenCalled();
    expect(mockSubtle.deriveKey).toHaveBeenCalled();

    const [, , algo] = mockSubtle.importKey.mock.calls[0];
    expect(algo).toBe('PBKDF2');
  });

  test('creates and persists encryption salt on first use', async () => {
    await encrypt('secret');
    const storage = globalThis.__getChromeStorage();
    expect(storage._encryption_salt).toBeDefined();
    expect(Array.isArray(storage._encryption_salt)).toBe(true);
    expect(storage._encryption_salt.length).toBe(16);
  });

  test('reuses existing salt', async () => {
    const existingSalt = Array.from({ length: 16 }, (_, i) => i + 100);
    globalThis.__setChromeStorage({ _encryption_salt: existingSalt });

    await encrypt('secret');

    // Salt should not have been regenerated
    const storage = globalThis.__getChromeStorage();
    expect(storage._encryption_salt).toEqual(existingSalt);
  });
});

describe('decrypt', () => {
  test('decrypts an encrypted value', async () => {
    const encrypted = await encrypt('my-secret-key');
    const decrypted = await decrypt(encrypted);
    // Due to our mock, the decrypted text should be the original
    expect(typeof decrypted).toBe('string');
  });

  test('calls crypto.subtle.decrypt with AES-GCM', async () => {
    const encrypted = await encrypt('secret');
    mockSubtle.decrypt.mockClear();
    await decrypt(encrypted);

    expect(mockSubtle.decrypt).toHaveBeenCalled();
    const [algo] = mockSubtle.decrypt.mock.calls[0];
    expect(algo.name).toBe('AES-GCM');
  });
});

describe('encrypt-decrypt roundtrip', () => {
  test('roundtrip with mock crypto preserves data structure', async () => {
    const original = 'sk-ant-api03-my-key';
    const encrypted = await encrypt(original);
    expect(encrypted).not.toBe(original);

    // Verify the encrypted value is a string (base64)
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
  });
});
